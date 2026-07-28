import { describe, expect, it } from "vitest";
import {
  caseClockDeadline,
  caseClockProjection,
  caseRemainingMilliseconds,
  hasCaseClockStarted,
  isCaseExpired,
  startedCaseClock,
  type CaseClockSession,
} from "@/lib/voice/case-clock";

const START = "2026-07-17T12:00:00.000Z";
const startMs = Date.parse(START);

function session(patch: Partial<CaseClockSession> = {}): CaseClockSession {
  return { maxDurationSeconds: 600, ...patch };
}

describe("case clock", () => {
  describe("deadline derivation", () => {
    it("adds the duration to the start instant", () => {
      expect(caseClockDeadline(START, 600)).toBe("2026-07-17T12:10:00.000Z");
      expect(caseClockDeadline(START, 1200)).toBe("2026-07-17T12:20:00.000Z");
    });

    it("has no deadline without both a start and a positive duration", () => {
      expect(caseClockDeadline(null, 600)).toBeNull();
      expect(caseClockDeadline(START, undefined)).toBeNull();
      expect(caseClockDeadline(START, 0)).toBeNull();
      expect(caseClockDeadline("not-a-date", 600)).toBeNull();
    });
  });

  describe("expiry is derived, never assumed", () => {
    const started = session({ caseStartedAt: START, caseExpiresAt: caseClockDeadline(START, 600) });

    it("is false before the deadline and true at or beyond it", () => {
      expect(isCaseExpired(started, startMs + 599_000)).toBe(false);
      // Exactly at the deadline counts as expired.
      expect(isCaseExpired(started, startMs + 600_000)).toBe(true);
      expect(isCaseExpired(started, startMs + 10_000_000)).toBe(true);
    });

    it("holds regardless of the persisted caseTimedOut flag", () => {
      // A stale/lost observation must not make an expired case look live...
      expect(isCaseExpired({ ...started, caseTimedOut: false }, startMs + 700_000)).toBe(true);
      // ...nor a live case look expired.
      expect(isCaseExpired({ ...started, caseTimedOut: true }, startMs + 1_000)).toBe(false);
    });

    it("never expires a session that has no deadline", () => {
      expect(isCaseExpired(session(), Number.MAX_SAFE_INTEGER)).toBe(false);
      // Legacy record with no timing fields at all.
      expect(isCaseExpired({}, Number.MAX_SAFE_INTEGER)).toBe(false);
    });

    it("reports remaining time, floored at zero", () => {
      expect(caseRemainingMilliseconds(started, startMs)).toBe(600_000);
      expect(caseRemainingMilliseconds(started, startMs + 599_000)).toBe(1_000);
      expect(caseRemainingMilliseconds(started, startMs + 900_000)).toBe(0);
      expect(caseRemainingMilliseconds(session(), startMs)).toBeNull();
    });
  });

  describe("first-write-wins start", () => {
    it("starts an unstarted case and derives its deadline", () => {
      const next = startedCaseClock(session(), START);
      expect(next.caseStartedAt).toBe(START);
      expect(next.caseExpiresAt).toBe("2026-07-17T12:10:00.000Z");
    });

    it("never restarts or extends an already-started case", () => {
      const started = session({
        caseStartedAt: START,
        caseExpiresAt: "2026-07-17T12:10:00.000Z",
      });
      // Repeated readiness messages, duplicate anchors, retries, second tabs.
      for (const later of ["2026-07-17T12:05:00.000Z", "2026-07-17T12:09:59.000Z"]) {
        const next = startedCaseClock(started, later);
        expect(next.caseStartedAt).toBe(START);
        expect(next.caseExpiresAt).toBe("2026-07-17T12:10:00.000Z");
      }
    });

    it("does not fabricate a deadline when no duration was snapshotted", () => {
      const next = startedCaseClock({}, START);
      expect(next.caseStartedAt).toBe(START);
      expect(next.caseExpiresAt).toBeNull();
    });

    it("hasCaseClockStarted requires both a start and a deadline", () => {
      expect(hasCaseClockStarted(session())).toBe(false);
      expect(hasCaseClockStarted(session({ caseStartedAt: START }))).toBe(false);
      expect(
        hasCaseClockStarted(session({ caseStartedAt: START, caseExpiresAt: "2026-07-17T12:10:00.000Z" })),
      ).toBe(true);
    });
  });

  describe("projection", () => {
    it("returns the clock plus server time and derived expiry", () => {
      const started = session({
        caseStartedAt: START,
        caseExpiresAt: "2026-07-17T12:10:00.000Z",
      });
      expect(caseClockProjection(started, startMs + 60_000)).toEqual({
        maxDurationSeconds: 600,
        caseStartedAt: START,
        caseExpiresAt: "2026-07-17T12:10:00.000Z",
        serverNow: "2026-07-17T12:01:00.000Z",
        timedOut: false,
      });
      expect(caseClockProjection(started, startMs + 700_000).timedOut).toBe(true);
    });

    it("is safe for a legacy session with no timing fields", () => {
      expect(caseClockProjection({}, startMs)).toEqual({
        maxDurationSeconds: null,
        caseStartedAt: null,
        caseExpiresAt: null,
        serverNow: START,
        timedOut: false,
      });
    });
  });
});
