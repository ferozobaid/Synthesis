import { describe, expect, it } from "vitest";
import { POST as manualCasePOST } from "@/app/api/case/route";
import { mockCase } from "@/lib/__mocks__/fixtures";
import { getVoiceLlmCaseRecord, voiceCaseRecord } from "@/lib/voice/voice-case-records";

const AIRPORT = "airport_profitability";
const GYM = "gcc_premium_gym_market_entry";

function manualRequest(body: unknown): Request {
  return new Request("http://localhost/api/case", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("manual /api/case case isolation", () => {
  it("keeps the shared mockCase registry limited to Beautify and Diconsa", () => {
    expect(mockCase("beautify")?.id).toBe("beautify");
    expect(mockCase("diconsa")?.id).toBe("diconsa");
    expect(mockCase(AIRPORT)).toBeUndefined();
    expect(mockCase(GYM)).toBeUndefined();
  });

  it("resolves the two Preview LLM cases only through the separate voice registry", () => {
    expect(getVoiceLlmCaseRecord(AIRPORT)?.id).toBe(AIRPORT);
    expect(getVoiceLlmCaseRecord(GYM)?.id).toBe(GYM);
    expect(getVoiceLlmCaseRecord("beautify")).toBeUndefined();
    expect(getVoiceLlmCaseRecord("diconsa")).toBeUndefined();

    // The unified voice resolver serves Beautify (legacy) plus the two LLM cases,
    // and never Diconsa or unknown ids.
    expect(voiceCaseRecord("beautify")?.id).toBe("beautify");
    expect(voiceCaseRecord(AIRPORT)?.id).toBe(AIRPORT);
    expect(voiceCaseRecord(GYM)?.id).toBe(GYM);
    expect(voiceCaseRecord("diconsa")).toBeUndefined();
    expect(voiceCaseRecord("unknown_case")).toBeUndefined();
  });

  it("rejects the new LLM cases from the manual route with 404", async () => {
    for (const caseId of [AIRPORT, GYM]) {
      const response = await manualCasePOST(manualRequest({ action: "start", caseId }) as never);
      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json).toEqual({ error: "case not found" });
    }
  });
});
