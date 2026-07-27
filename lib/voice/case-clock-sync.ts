/**
 * Native Case clock synchronizer (client side).
 *
 * The native architecture has no server turn loop, so the browser must tell the
 * server when the case actually began (detected by transcript anchor). That request
 * is NOT fire-and-forget: a transient failure would otherwise leave the interview
 * with no deadline at all.
 *
 * Guarantees:
 *  - The server is the only source of a deadline. This module NEVER synthesizes a
 *    client-side fallback deadline; if the server cannot be reached there is simply
 *    no deadline and the UI degrades to a neutral state.
 *  - GET before POST. On mount an already-started clock is restored, never restarted.
 *    A POST is issued only when the server reports no start AND the caller confirms
 *    the case has genuinely begun.
 *  - Exactly one scheduler. `ensure()` is idempotent, so duplicated React effects,
 *    re-renders, and repeated anchor detections cannot create parallel retry loops.
 *  - Bounded backoff on transient errors; authorization failures stop immediately
 *    rather than retrying forever.
 *  - Retrying is safe: the server applies first-write-wins and returns the original
 *    deadline, so a duplicate POST cannot extend or restart the interview.
 */

/** Server clock snapshot; mirrors caseClockProjection in lib/voice/case-clock.ts. */
export interface CaseClockSnapshot {
  maxDurationSeconds: number | null;
  caseStartedAt: string | null;
  caseExpiresAt: string | null;
  serverNow: string;
  timedOut: boolean;
}

/** Raised for 401/403/404 — a credential or session problem retrying cannot fix. */
export class CaseClockAuthError extends Error {
  constructor() {
    super("case clock capability rejected");
    this.name = "CaseClockAuthError";
  }
}

/** Bounded backoff. Exhausting it stops the loop; the UI degrades to no deadline. */
export const CASE_CLOCK_RETRY_DELAYS_MS: readonly number[] = [
  500, 1_000, 2_000, 4_000, 8_000, 15_000,
] as const;

/** Delay before attempt `n` (0-based), or null when the budget is exhausted. */
export function caseClockRetryDelay(attempt: number): number | null {
  return CASE_CLOCK_RETRY_DELAYS_MS[attempt] ?? null;
}

/** True once the server has issued a real deadline. */
export function isAuthoritativeClock(
  snapshot: CaseClockSnapshot | null,
): snapshot is CaseClockSnapshot {
  return !!snapshot && !!snapshot.caseStartedAt && !!snapshot.caseExpiresAt;
}

/**
 * Browser/server clock offset in ms, from a snapshot's serverNow and the local
 * time when it was received. Add to Date.now() to get server-aligned time.
 */
export function caseClockSkewOffsetMs(
  snapshot: CaseClockSnapshot,
  receivedAtMs: number,
): number {
  const serverNow = Date.parse(snapshot.serverNow);
  return Number.isFinite(serverNow) ? serverNow - receivedAtMs : 0;
}

/** Milliseconds remaining, corrected for skew. Null when there is no deadline. */
export function caseClockRemainingMs(
  snapshot: CaseClockSnapshot | null,
  nowMs: number,
  offsetMs: number,
): number | null {
  if (!isAuthoritativeClock(snapshot)) return null;
  const expiresAt = Date.parse(snapshot.caseExpiresAt!);
  if (!Number.isFinite(expiresAt)) return null;
  return Math.max(0, expiresAt - (nowMs + offsetMs));
}

export type CaseClockCancel = () => void;

export interface CaseClockControllerOptions {
  /** GET the current clock. */
  fetchClock: () => Promise<CaseClockSnapshot>;
  /** POST to start the clock (first-write-wins server side). */
  startClock: () => Promise<CaseClockSnapshot>;
  /**
   * Evidence the case has genuinely begun — the live anchor, or restored
   * transcript/live state after a remount. Only then is a start POST legitimate.
   */
  hasCaseStarted: () => boolean;
  /** False once the call is over; stops retrying. */
  isActive: () => boolean;
  /** Delivers every authoritative snapshot with the local receipt time. */
  onSnapshot: (snapshot: CaseClockSnapshot, receivedAtMs: number) => void;
  /** Injected for tests. */
  schedule?: (fn: () => void, ms: number) => CaseClockCancel;
  now?: () => number;
}

export interface CaseClockController {
  /** Idempotent: starts the sync loop unless one is already running or settled. */
  ensure: () => void;
  /** Cancels any pending retry. */
  dispose: () => void;
  /** Test/debug introspection. */
  readonly state: () => { running: boolean; settled: boolean; attempt: number };
}

const defaultSchedule = (fn: () => void, ms: number): CaseClockCancel => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

export function createCaseClockController(
  options: CaseClockControllerOptions,
): CaseClockController {
  const schedule = options.schedule ?? defaultSchedule;
  const now = options.now ?? Date.now;

  let running = false;
  let settled = false;
  let disposed = false;
  let attempt = 0;
  let cancelPending: CaseClockCancel | null = null;

  const clearPending = () => {
    cancelPending?.();
    cancelPending = null;
  };

  const settle = (snapshot: CaseClockSnapshot) => {
    settled = true;
    running = false;
    clearPending();
    options.onSnapshot(snapshot, now());
  };

  const stop = () => {
    running = false;
    clearPending();
  };

  const retry = () => {
    const delay = caseClockRetryDelay(attempt);
    attempt += 1;
    // Budget exhausted, call over, or disposed: stop. No client-side deadline is
    // ever invented as a substitute.
    if (delay === null || disposed || !options.isActive()) {
      stop();
      return;
    }
    cancelPending = schedule(() => {
      cancelPending = null;
      void run();
    }, delay);
  };

  const run = async (): Promise<void> => {
    if (disposed || settled) {
      running = false;
      return;
    }
    if (!options.isActive()) {
      stop();
      return;
    }
    try {
      // Always read first: a clock started by an earlier mount, another tab, or a
      // previous attempt must be restored rather than restarted.
      const current = await options.fetchClock();
      if (disposed) return;
      if (isAuthoritativeClock(current)) {
        settle(current);
        return;
      }
      // Server reports no start. Only ask for one when the case really has begun
      // (live anchor, or restored evidence after a remount).
      if (!options.hasCaseStarted()) {
        retry();
        return;
      }
      const started = await options.startClock();
      if (disposed) return;
      if (isAuthoritativeClock(started)) {
        settle(started);
        return;
      }
      retry();
    } catch (error) {
      if (disposed) return;
      // A rejected capability cannot be fixed by retrying.
      if (error instanceof CaseClockAuthError) {
        stop();
        return;
      }
      retry();
    }
  };

  return {
    ensure() {
      // The single guard that makes duplicate effects harmless.
      if (disposed || settled || running) return;
      running = true;
      attempt = 0;
      void run();
    },
    dispose() {
      disposed = true;
      stop();
    },
    state: () => ({ running, settled, attempt }),
  };
}
