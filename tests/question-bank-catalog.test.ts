import { describe, expect, it } from "vitest";
import {
  strategyCatalogCases,
  technicalCatalogCasesByRole,
  type PreviewCaseChoice,
} from "@/components/CaseVoiceInterview";
import { GET as catalogGET } from "@/app/api/case/catalog/route";
import {
  CASE_VOICE_QUESTION_ANCHOR_VERSION,
  resolveCaseVoiceArchitectureForCase,
  resolveNativeCaseAssistant,
} from "@/lib/voice/case-native-config";

const CLICKSTREAM = "data_engineer_clickstream";
const DE_ROUND = "data_engineer_technical_round";
const DA_ROUND = "data_analyst_technical_round";

async function realCatalog(): Promise<PreviewCaseChoice[]> {
  const response = await catalogGET();
  const { cases } = (await response.json()) as { cases: PreviewCaseChoice[] };
  return cases;
}

describe("catalog classification — technical rounds", () => {
  it("Data Engineering contains Clickstream and the DE technical round", async () => {
    const byRole = technicalCatalogCasesByRole(await realCatalog());
    expect(byRole.data_engineering?.map((c) => c.id)).toEqual([CLICKSTREAM, DE_ROUND]);
  });

  it("Data Analyst is now active with its technical round", async () => {
    const byRole = technicalCatalogCasesByRole(await realCatalog());
    expect(byRole.data_analyst?.map((c) => c.id)).toEqual([DA_ROUND]);
    expect((byRole.data_analyst ?? []).length).toBeGreaterThan(0);
  });

  it("both new rounds are technical, never strategy", async () => {
    const strategy = strategyCatalogCases(await realCatalog());
    expect(strategy.some((c) => c.id === DE_ROUND || c.id === DA_ROUND)).toBe(false);
    expect(strategy.map((c) => c.id).sort()).toEqual(
      ["airport_profitability", "gcc_premium_gym_market_entry"].sort(),
    );
  });
});

describe("native assistant-id resolution", () => {
  it("resolves the DA round assistant from its server-only env var with the question anchor version", () => {
    const config = resolveNativeCaseAssistant(DA_ROUND, {
      VAPI_DATA_ANALYST_TECHNICAL_ROUND_ASSISTANT_ID: "asst-da-123",
    });
    expect(config?.assistantId).toBe("asst-da-123");
    expect(config?.stageAnchorVersion).toBe(CASE_VOICE_QUESTION_ANCHOR_VERSION);
    expect(config?.assistantConfigVersion).toBe("data-analyst-technical-round-assistant-v1");
  });

  it("resolves the DE round assistant from its server-only env var", () => {
    const config = resolveNativeCaseAssistant(DE_ROUND, {
      VAPI_DATA_ENGINEER_TECHNICAL_ROUND_ASSISTANT_ID: "asst-de-456",
    });
    expect(config?.assistantId).toBe("asst-de-456");
    expect(config?.stageAnchorVersion).toBe(CASE_VOICE_QUESTION_ANCHOR_VERSION);
  });

  it("returns null when the round's assistant id is unset", () => {
    expect(resolveNativeCaseAssistant(DA_ROUND, {})).toBeNull();
    expect(resolveNativeCaseAssistant(DE_ROUND, {})).toBeNull();
  });

  it("does not read the Clickstream env var for the DE round (isolated mapping)", () => {
    expect(
      resolveNativeCaseAssistant(DE_ROUND, { VAPI_DATA_ENGINEER_ASSISTANT_ID: "clickstream-only" }),
    ).toBeNull();
  });
});

describe("forced native architecture — new rounds only", () => {
  it("both rounds always resolve vapi_native regardless of env", () => {
    expect(resolveCaseVoiceArchitectureForCase(DA_ROUND, {})).toBe("vapi_native");
    expect(resolveCaseVoiceArchitectureForCase(DE_ROUND, {})).toBe("vapi_native");
    expect(resolveCaseVoiceArchitectureForCase(DA_ROUND, { CASE_VOICE_ARCHITECTURE: "custom_llm" })).toBe("vapi_native");
  });

  it("does not alter Airport / GCC architecture behavior", () => {
    expect(resolveCaseVoiceArchitectureForCase("airport_profitability", {})).toBe("custom_llm");
    expect(
      resolveCaseVoiceArchitectureForCase("gcc_premium_gym_market_entry", { CASE_VOICE_ARCHITECTURE: "vapi_native" }),
    ).toBe("vapi_native");
    expect(
      resolveCaseVoiceArchitectureForCase("airport_profitability", { CASE_VOICE_ARCHITECTURE: "custom_llm" }),
    ).toBe("custom_llm");
  });

  it("Clickstream architecture behavior is unchanged (native only when its own id is set)", () => {
    expect(resolveCaseVoiceArchitectureForCase(CLICKSTREAM, {})).toBe("custom_llm");
    expect(
      resolveCaseVoiceArchitectureForCase(CLICKSTREAM, { VAPI_DATA_ENGINEER_ASSISTANT_ID: "x" }),
    ).toBe("vapi_native");
  });
});
