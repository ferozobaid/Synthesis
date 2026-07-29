import { describe, expect, it, vi } from "vitest";
import {
  CaseClockAuthError,
  CASE_CLOCK_RETRY_DELAYS_MS,
  caseClockRemainingMs,
  caseClockRetryDelay,
  caseClockSkewOffsetMs,
  createCaseClockController,
  isAuthoritativeClock,
  type CaseClockSnapshot,
} from "@/lib/voice/case-clock-sync";
import {
  CASE_TIMER_WARNING_THRESHOLDS_MS,
  caseTimerWarningThreshold,
  crossedCaseTimerWarnings,
  formatCaseVoiceElapsed,
} from "@/components/CaseVoiceInterview";

const START = "2026-07-17T12:00:00.000Z";
const EXPIRES = "2026-07-17T12:15:00.000Z";

function snapshot(patch: Partial<CaseClockSnapshot> = {}): CaseClockSnapshot {
  return {
    maxDurationSeconds: 900,
    caseStartedAt: START,
    caseExpiresAt: EXPIRES,
    serverNow: START,
    timedOut: false,
    ...patch,
  };
}

const UNSTARTED = snapshot({ caseStartedAt: null, caseExpiresAt: null });

/** Deterministic scheduler: nothing runs until flush() is called. */
function manualScheduler() {
  const queue: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    queue,
    schedule: (fn: () => void, ms: number) => {
      const entry = { fn, ms, cancelled: false };
      queue.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    async flush(times = 1) {
      for (let i = 0; i < times; i++) {
        const next = queue.find((entry) => !entry.cancelled && !("ran" in entry));
        if (!next) return;
        Object.assign(next, { ran: true });
        next.fn();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    pending: () => queue.filter((entry) => !entry.cancelled && !("ran" in entry)).length,
  };
}

describe("case countdown", () => {
  describe("remaining time", () => {
    it("begins at 15:00 and counts down from the server deadline", () => {
      expect(formatCaseVoiceElapsed(caseClockRemainingMs(snapshot(), Date.parse(START), 0)!))
        .toBe("15:00");
      const now = Date.parse("2026-07-17T12:06:20.000Z");
      expect(formatCaseVoiceElapsed(caseClockRemainingMs(snapshot(), now, 0)!)).toBe("08:40");
    });

    it("floors at zero past the deadline instead of going negative", () => {
      expect(caseClockRemainingMs(snapshot(), Date.parse("2026-07-17T12:30:00.000Z"), 0)).toBe(0);
    });

    it("has no countdown without an authoritative deadline", () => {
      expect(caseClockRemainingMs(null, Date.now(), 0)).toBeNull();
      expect(caseClockRemainingMs(UNSTARTED, Date.now(), 0)).toBeNull();
      expect(isAuthoritativeClock(UNSTARTED)).toBe(false);
      expect(isAuthoritativeClock(snapshot())).toBe(true);
    });

    it("corrects for a browser clock that is wrong in either direction", () => {
      const trueNow = Date.parse("2026-07-17T12:05:00.000Z");
      // Browser is 90s BEHIND the server.
      const behind = snapshot({ serverNow: "2026-07-17T12:05:00.000Z" });
      const offsetBehind = caseClockSkewOffsetMs(behind, trueNow - 90_000);
      expect(offsetBehind).toBe(90_000);
      expect(
        formatCaseVoiceElapsed(caseClockRemainingMs(behind, trueNow - 90_000, offsetBehind)!),
      ).toBe("10:00");

      // Browser is 90s AHEAD of the server.
      const ahead = snapshot({ serverNow: "2026-07-17T12:05:00.000Z" });
      const offsetAhead = caseClockSkewOffsetMs(ahead, trueNow + 90_000);
      expect(offsetAhead).toBe(-90_000);
      expect(
        formatCaseVoiceElapsed(caseClockRemainingMs(ahead, trueNow + 90_000, offsetAhead)!),
      ).toBe("10:00");
    });
  });

  describe("warnings", () => {
    it("warns at 5, 2 and 1 minutes remaining", () => {
      expect(CASE_TIMER_WARNING_THRESHOLDS_MS).toEqual([300_000, 120_000, 60_000]);
    });

    it("raises each threshold exactly once as time drains", () => {
      const readings = [900_000, 301_000, 300_000, 200_000, 120_000, 61_000, 60_000, 30_000, 0];
      const raised: number[] = [];
      let previous: number | null = null;
      for (const remaining of readings) {
        raised.push(...crossedCaseTimerWarnings(previous, remaining));
        previous = remaining;
      }
      expect(raised).toEqual([300_000, 120_000, 60_000]);
    });

    it("raises nothing above the first threshold and nothing without a deadline", () => {
      expect(crossedCaseTimerWarnings(null, 900_000)).toEqual([]);
      expect(crossedCaseTimerWarnings(900_000, null)).toEqual([]);
    });

    it("reports the tightest band currently entered", () => {
      expect(caseTimerWarningThreshold(900_000)).toBeNull();
      expect(caseTimerWarningThreshold(240_000)).toBe(300_000);
      expect(caseTimerWarningThreshold(90_000)).toBe(120_000);
      expect(caseTimerWarningThreshold(30_000)).toBe(60_000);
      expect(caseTimerWarningThreshold(null)).toBeNull();
    });
  });
});

describe("native clock synchronizer", () => {
  it("uses a bounded backoff budget", () => {
    expect(caseClockRetryDelay(0)).toBe(CASE_CLOCK_RETRY_DELAYS_MS[0]);
    expect(caseClockRetryDelay(CASE_CLOCK_RETRY_DELAYS_MS.length)).toBeNull();
  });

  it("restores an already-started clock without posting a start", async () => {
    const startClock = vi.fn();
    const onSnapshot = vi.fn();
    const controller = createCaseClockController({
      fetchClock: vi.fn().mockResolvedValue(snapshot()),
      startClock,
      hasCaseStarted: () => true,
      isActive: () => true,
      onSnapshot,
    });
    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();

    expect(startClock).not.toHaveBeenCalled();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot.mock.calls[0][0].caseExpiresAt).toBe(EXPIRES);
    expect(controller.state().settled).toBe(true);
  });

  it("retries a transient start failure and keeps ONE authoritative deadline", async () => {
    const scheduler = manualScheduler();
    const fetchClock = vi.fn().mockResolvedValue(UNSTARTED);
    const startClock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(snapshot());
    const onSnapshot = vi.fn();

    const controller = createCaseClockController({
      fetchClock,
      startClock,
      hasCaseStarted: () => true,
      isActive: () => true,
      onSnapshot,
      schedule: scheduler.schedule,
    });

    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // First attempt failed, a retry is queued, and no deadline was invented.
    expect(startClock).toHaveBeenCalledTimes(1);
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(scheduler.pending()).toBe(1);

    await scheduler.flush();

    expect(startClock).toHaveBeenCalledTimes(2);
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot.mock.calls[0][0].caseExpiresAt).toBe(EXPIRES);
    expect(controller.state().settled).toBe(true);
    // Settled: no further work scheduled.
    expect(scheduler.pending()).toBe(0);
  });

  it("recovers a previously failed start on remount when case-start evidence remains", async () => {
    // Fresh controller (as after a remount): server still shows no start, and the
    // restored live state proves the case began, so it posts again.
    const startClock = vi.fn().mockResolvedValue(snapshot());
    const onSnapshot = vi.fn();
    const controller = createCaseClockController({
      fetchClock: vi.fn().mockResolvedValue(UNSTARTED),
      startClock,
      hasCaseStarted: () => true,
      isActive: () => true,
      onSnapshot,
    });

    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(startClock).toHaveBeenCalledTimes(1);
    expect(onSnapshot.mock.calls[0][0].caseExpiresAt).toBe(EXPIRES);
  });

  it("does not post a start when the case has not actually begun", async () => {
    const scheduler = manualScheduler();
    const startClock = vi.fn();
    const controller = createCaseClockController({
      fetchClock: vi.fn().mockResolvedValue(UNSTARTED),
      startClock,
      // Readiness dialogue: no anchor yet.
      hasCaseStarted: () => false,
      isActive: () => true,
      onSnapshot: vi.fn(),
      schedule: scheduler.schedule,
    });

    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(startClock).not.toHaveBeenCalled();
  });

  it("waits on its own fixed poll without touching the retry budget, however long the wait", async () => {
    const scheduler = manualScheduler();
    let started = false;
    const startClock = vi.fn().mockResolvedValue(snapshot());
    const controller = createCaseClockController({
      fetchClock: vi.fn().mockResolvedValue(UNSTARTED),
      startClock,
      hasCaseStarted: () => started,
      isActive: () => true,
      onSnapshot: vi.fn(),
      schedule: scheduler.schedule,
    });

    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();

    // Wait through MORE ticks than the entire retry budget has slots — the wait
    // must never expire and must never touch `attempt`.
    for (let i = 0; i < CASE_CLOCK_RETRY_DELAYS_MS.length + 4; i++) {
      expect(controller.state().attempt).toBe(0);
      await scheduler.flush();
    }
    expect(startClock).not.toHaveBeenCalled();

    // Now the case genuinely begins.
    started = true;
    await scheduler.flush();

    expect(startClock).toHaveBeenCalledTimes(1);
    expect(controller.state().settled).toBe(true);
    expect(controller.state().attempt).toBe(0);
  });

  it("posts within one poll interval of the false → true transition", async () => {
    const scheduler = manualScheduler();
    let started = false;
    const startClock = vi.fn().mockResolvedValue(snapshot());
    const controller = createCaseClockController({
      fetchClock: vi.fn().mockResolvedValue(UNSTARTED),
      startClock,
      hasCaseStarted: () => started,
      isActive: () => true,
      onSnapshot: vi.fn(),
      schedule: scheduler.schedule,
    });

    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();
    await scheduler.flush(); // one wait tick while still unstarted
    expect(startClock).not.toHaveBeenCalled();

    // The anchor fires between two poll ticks — a single scheduled interval later
    // the controller must have already posted.
    started = true;
    expect(scheduler.pending()).toBe(1);
    await scheduler.flush();

    expect(startClock).toHaveBeenCalledTimes(1);
  });

  it("keeps the genuine network-error retry budget untouched by a preceding wait", async () => {
    const scheduler = manualScheduler();
    let started = false;
    const startClock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(snapshot());
    const controller = createCaseClockController({
      fetchClock: vi.fn().mockResolvedValue(UNSTARTED),
      startClock,
      hasCaseStarted: () => started,
      isActive: () => true,
      onSnapshot: vi.fn(),
      schedule: scheduler.schedule,
    });

    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();

    // Several wait ticks first — none of these are retries.
    for (let i = 0; i < 3; i++) await scheduler.flush();
    expect(controller.state().attempt).toBe(0);

    // The case begins; the first start attempt fails transiently.
    started = true;
    await scheduler.flush();
    expect(startClock).toHaveBeenCalledTimes(1);
    // The wait consumed none of the budget, so this is genuinely attempt 0→1.
    expect(controller.state().attempt).toBe(1);

    await scheduler.flush();
    expect(startClock).toHaveBeenCalledTimes(2);
    expect(controller.state().settled).toBe(true);
  });

  it("keeps exactly one scheduled poll while duplicate ensure() calls arrive during the wait", async () => {
    const scheduler = manualScheduler();
    const controller = createCaseClockController({
      fetchClock: vi.fn().mockResolvedValue(UNSTARTED),
      startClock: vi.fn(),
      hasCaseStarted: () => false,
      isActive: () => true,
      onSnapshot: vi.fn(),
      schedule: scheduler.schedule,
    });

    for (let i = 0; i < 6; i++) controller.ensure();
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.pending()).toBe(1);

    await scheduler.flush();
    for (let i = 0; i < 4; i++) controller.ensure();
    expect(scheduler.pending()).toBe(1);
  });

  it("dispose cancels a pending wait tick, so a stale start is never posted", async () => {
    const scheduler = manualScheduler();
    const fetchClock = vi.fn().mockResolvedValue(UNSTARTED);
    const startClock = vi.fn().mockResolvedValue(snapshot());
    const controller = createCaseClockController({
      fetchClock,
      startClock,
      // Still waiting (readiness dialogue): this schedules a wait tick, not a
      // start — that pending tick is what dispose() must cancel.
      hasCaseStarted: () => false,
      isActive: () => true,
      onSnapshot: vi.fn(),
      schedule: scheduler.schedule,
    });

    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.pending()).toBe(1);

    controller.dispose();
    await scheduler.flush(3);

    expect(fetchClock).toHaveBeenCalledTimes(1);
    expect(startClock).not.toHaveBeenCalled();
    expect(scheduler.pending()).toBe(0);
  });

  it("short-circuits on an already-authoritative deadline with no wait or retry loop at all", async () => {
    const scheduler = manualScheduler();
    const fetchClock = vi.fn().mockResolvedValue(snapshot());
    const startClock = vi.fn();
    const controller = createCaseClockController({
      fetchClock,
      startClock,
      hasCaseStarted: () => true,
      isActive: () => true,
      onSnapshot: vi.fn(),
      schedule: scheduler.schedule,
    });

    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchClock).toHaveBeenCalledTimes(1);
    expect(startClock).not.toHaveBeenCalled();
    expect(scheduler.pending()).toBe(0);
    expect(controller.state().settled).toBe(true);
  });

  it("stops immediately on an authorization failure instead of retrying forever", async () => {
    const scheduler = manualScheduler();
    const fetchClock = vi.fn().mockRejectedValue(new CaseClockAuthError());
    const controller = createCaseClockController({
      fetchClock,
      startClock: vi.fn(),
      hasCaseStarted: () => true,
      isActive: () => true,
      onSnapshot: vi.fn(),
      schedule: scheduler.schedule,
    });

    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchClock).toHaveBeenCalledTimes(1);
    expect(scheduler.pending()).toBe(0);
    expect(controller.state().running).toBe(false);
    expect(controller.state().settled).toBe(false);
  });

  it("gives up after the retry budget without inventing a deadline", async () => {
    const scheduler = manualScheduler();
    const onSnapshot = vi.fn();
    const controller = createCaseClockController({
      fetchClock: vi.fn().mockRejectedValue(new Error("network")),
      startClock: vi.fn(),
      hasCaseStarted: () => true,
      isActive: () => true,
      onSnapshot,
      schedule: scheduler.schedule,
    });

    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();
    await scheduler.flush(CASE_CLOCK_RETRY_DELAYS_MS.length + 2);

    expect(onSnapshot).not.toHaveBeenCalled();
    expect(controller.state().settled).toBe(false);
    expect(scheduler.pending()).toBe(0);
  });

  it("stops retrying once the call is over", async () => {
    const scheduler = manualScheduler();
    let active = true;
    const controller = createCaseClockController({
      fetchClock: vi.fn().mockRejectedValue(new Error("network")),
      startClock: vi.fn(),
      hasCaseStarted: () => true,
      isActive: () => active,
      onSnapshot: vi.fn(),
      schedule: scheduler.schedule,
    });

    controller.ensure();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    active = false;
    await scheduler.flush(3);

    expect(scheduler.pending()).toBe(0);
    expect(controller.state().running).toBe(false);
  });

  it("duplicate effect runs cannot create parallel retry schedulers", async () => {
    const scheduler = manualScheduler();
    const fetchClock = vi.fn().mockRejectedValue(new Error("network"));
    const controller = createCaseClockController({
      fetchClock,
      startClock: vi.fn(),
      hasCaseStarted: () => true,
      isActive: () => true,
      onSnapshot: vi.fn(),
      schedule: scheduler.schedule,
    });

    // React StrictMode double-invoke, re-renders, repeated anchor detections.
    for (let i = 0; i < 8; i++) controller.ensure();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchClock).toHaveBeenCalledTimes(1);
    expect(scheduler.pending()).toBe(1);

    // Still exactly one scheduler after further ensure() calls mid-flight.
    for (let i = 0; i < 4; i++) controller.ensure();
    expect(scheduler.pending()).toBe(1);
  });

  it("does no further work after dispose", async () => {
    const scheduler = manualScheduler();
    const fetchClock = vi.fn().mockRejectedValue(new Error("network"));
    const controller = createCaseClockController({
      fetchClock,
      startClock: vi.fn(),
      hasCaseStarted: () => true,
      isActive: () => true,
      onSnapshot: vi.fn(),
      schedule: scheduler.schedule,
    });

    controller.ensure();
    await Promise.resolve();
    controller.dispose();
    await scheduler.flush(3);

    expect(fetchClock).toHaveBeenCalledTimes(1);
    expect(scheduler.pending()).toBe(0);
  });
});
