import { describe, expect, it } from "vitest";
import {
  buildCaseVoiceLogicalTurnKey,
  buildCaseVoiceRequestCacheKey,
} from "@/lib/voice/case-turn-cache";
import { CASE_VOICE_CONTROLLER_VERSION } from "@/lib/voice/case-turn-plan";

const BASE_MESSAGES = [
  { role: "assistant", content: "Current authored prompt" },
  { role: "user", content: "Could we change direction?" },
];

describe("Case Voice controller cache identity", () => {
  it("keeps exact retries stable within the same mode and controller version", () => {
    const controller = { mode: "hybrid" as const, version: CASE_VOICE_CONTROLLER_VERSION };
    expect(buildCaseVoiceRequestCacheKey("session-1", "call-1", BASE_MESSAGES, controller))
      .toBe(buildCaseVoiceRequestCacheKey("session-1", "call-1", BASE_MESSAGES, controller));
    expect(buildCaseVoiceLogicalTurnKey("call-1", BASE_MESSAGES, 1, controller))
      .toBe(buildCaseVoiceLogicalTurnKey("call-1", BASE_MESSAGES, 1, controller));
  });

  it("separates shadow, off, and hybrid cache identities", () => {
    const shadow = buildCaseVoiceRequestCacheKey(
      "session-1",
      "call-1",
      BASE_MESSAGES,
      { mode: "shadow" },
    );
    const off = buildCaseVoiceRequestCacheKey(
      "session-1",
      "call-1",
      BASE_MESSAGES,
      { mode: "off" },
    );
    const hybrid = buildCaseVoiceRequestCacheKey(
      "session-1",
      "call-1",
      BASE_MESSAGES,
      { mode: "hybrid" },
    );

    expect(shadow).not.toBe(hybrid);
    expect(off).not.toBe(hybrid);
    expect(buildCaseVoiceLogicalTurnKey("call-1", BASE_MESSAGES, 1, { mode: "shadow" }))
      .not.toBe(buildCaseVoiceLogicalTurnKey("call-1", BASE_MESSAGES, 1, { mode: "hybrid" }));
  });

  it("invalidates request and logical-turn identities when the controller version changes", () => {
    expect(buildCaseVoiceRequestCacheKey(
      "session-1",
      "call-1",
      BASE_MESSAGES,
      { mode: "hybrid", version: "v1" },
    )).not.toBe(buildCaseVoiceRequestCacheKey(
      "session-1",
      "call-1",
      BASE_MESSAGES,
      { mode: "hybrid", version: "v2" },
    ));
    expect(buildCaseVoiceLogicalTurnKey(
      "call-1",
      BASE_MESSAGES,
      1,
      { mode: "hybrid", version: "v1" },
    )).not.toBe(buildCaseVoiceLogicalTurnKey(
      "call-1",
      BASE_MESSAGES,
      1,
      { mode: "hybrid", version: "v2" },
    ));
  });

  it("keeps progressive revisions in one logical slot within a mode and version", () => {
    const partial = [
      BASE_MESSAGES[0],
      { role: "user", content: "I have three clarifying questions." },
    ];
    const revision = [
      BASE_MESSAGES[0],
      { role: "user", content: "I have three clarifying questions. What time horizon should we use?" },
    ];

    expect(buildCaseVoiceLogicalTurnKey("call-1", partial, 1, { mode: "hybrid" }))
      .toBe(buildCaseVoiceLogicalTurnKey("call-1", revision, 1, { mode: "hybrid" }));
    expect(buildCaseVoiceRequestCacheKey("session-1", "call-1", partial, { mode: "hybrid" }))
      .not.toBe(buildCaseVoiceRequestCacheKey("session-1", "call-1", revision, { mode: "hybrid" }));
  });
});
