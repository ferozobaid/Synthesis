import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPIRED_REPORT_MESSAGE,
  PENDING_CLIENT_TTL_MS,
  PENDING_KEY,
  POLL_404_GRACE_MS,
  isPendingExpired,
  readPending,
  shouldExpireRepeated404,
  voiceOwnsManualMode,
} from "@/components/VoiceInterview";

function installLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
  vi.stubGlobal("window", { localStorage });
  return { store, localStorage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VoiceInterview pending report capability", () => {
  it("clears an expired localStorage capability on load", () => {
    const now = 1_000_000;
    const expired = {
      sessionId: "session-old",
      reportToken: "token-old",
      createdAt: now - PENDING_CLIENT_TTL_MS - 1,
    };
    const { store, localStorage } = installLocalStorage({
      [PENDING_KEY]: JSON.stringify(expired),
    });

    expect(isPendingExpired(expired, now)).toBe(true);
    expect(readPending(now)).toEqual({ pending: null, expired: true });
    expect(localStorage.removeItem).toHaveBeenCalledWith(PENDING_KEY);
    expect(store.has(PENDING_KEY)).toBe(false);
  });

  it("keeps a valid recent pending session resumable", () => {
    const now = 1_000_000;
    const pending = {
      sessionId: "session-recent",
      reportToken: "token-recent",
      createdAt: now - 60_000,
    };
    const { store, localStorage } = installLocalStorage({
      [PENDING_KEY]: JSON.stringify(pending),
    });

    expect(readPending(now)).toEqual({ pending, expired: false });
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(store.has(PENDING_KEY)).toBe(true);
  });

  it("does not retry repeated 404s for the full six-minute polling budget", () => {
    const first404 = 5_000;

    expect(shouldExpireRepeated404(null, first404)).toBe(false);
    expect(shouldExpireRepeated404(first404, first404 + POLL_404_GRACE_MS - 1)).toBe(false);
    expect(shouldExpireRepeated404(first404, first404 + POLL_404_GRACE_MS)).toBe(true);
  });

  it("restores manual mode when a stale report returns the voice panel to idle", () => {
    expect(voiceOwnsManualMode(true, "processing")).toBe(true);
    expect(voiceOwnsManualMode(true, "timeout")).toBe(true);
    expect(voiceOwnsManualMode(true, "idle")).toBe(false);
    expect(voiceOwnsManualMode(true, "failed")).toBe(false);
    expect(EXPIRED_REPORT_MESSAGE).toContain("expired");
    expect(EXPIRED_REPORT_MESSAGE).toContain("text mode");
  });
});
