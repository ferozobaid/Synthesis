import { describe, expect, it } from "vitest";
import {
  strategyCatalogCases,
  technicalCatalogCasesByRole,
  type PreviewCaseChoice,
} from "@/components/CaseVoiceInterview";
import { GET as catalogGET } from "@/app/api/case/catalog/route";
import { resolveNativeCaseAssistant } from "@/lib/voice/case-native-config";

const AIRPORT = "airport_profitability";
const GYM = "gcc_premium_gym_market_entry";
const DATA_ENGINEER = "data_engineer_clickstream";

async function realCatalog(): Promise<PreviewCaseChoice[]> {
  const response = await catalogGET();
  const { cases } = (await response.json()) as { cases: PreviewCaseChoice[] };
  return cases;
}

describe("picker track/role classification (data-driven, no hardcoded case-id branches)", () => {
  it("Strategy contains only Airport and GCC Gym — Data Engineer is excluded", async () => {
    const catalog = await realCatalog();
    const strategy = strategyCatalogCases(catalog);
    expect(strategy.map((entry) => entry.id).sort()).toEqual([AIRPORT, GYM].sort());
    expect(strategy.some((entry) => entry.id === DATA_ENGINEER)).toBe(false);
  });

  it("Airport and GCC Gym are unaffected: same id, title, and description as before", async () => {
    const catalog = await realCatalog();
    const strategy = strategyCatalogCases(catalog);
    expect(strategy.find((entry) => entry.id === AIRPORT)).toMatchObject({
      id: AIRPORT,
      title: "Airport Profitability",
      track: "strategy",
    });
    expect(strategy.find((entry) => entry.id === GYM)).toMatchObject({
      id: GYM,
      title: "GCC Premium Gym Market Entry",
      track: "strategy",
    });
  });

  it("Data Engineering appears under Technical, containing exactly the Clickstream case", async () => {
    const catalog = await realCatalog();
    const byRole = technicalCatalogCasesByRole(catalog);
    expect(byRole.data_engineering).toBeDefined();
    expect(byRole.data_engineering?.map((entry) => entry.id)).toEqual([DATA_ENGINEER]);
    expect(byRole.data_engineering?.[0]).toMatchObject({
      id: DATA_ENGINEER,
      title: "Clickstream Data Pipeline",
      track: "technical",
      role: "data_engineering",
    });
  });

  it("Data Analyst has no cases yet (stays an upcoming/disabled role)", async () => {
    const catalog = await realCatalog();
    const byRole = technicalCatalogCasesByRole(catalog);
    expect(byRole.data_analyst ?? []).toEqual([]);
  });

  it("no strategy case leaks into any technical role, and no technical case leaks into strategy", async () => {
    const catalog = await realCatalog();
    const strategyIds = new Set(strategyCatalogCases(catalog).map((entry) => entry.id));
    const technicalIds = new Set(
      Object.values(technicalCatalogCasesByRole(catalog)).flatMap(
        (entries) => (entries ?? []).map((entry) => entry.id),
      ),
    );
    for (const id of strategyIds) expect(technicalIds.has(id)).toBe(false);
    for (const id of technicalIds) expect(strategyIds.has(id)).toBe(false);
  });

  it("selecting Clickstream from the Data Engineering role list still yields case id data_engineer_clickstream", async () => {
    const catalog = await realCatalog();
    const clickstream = technicalCatalogCasesByRole(catalog).data_engineering?.[0];
    expect(clickstream?.id).toBe(DATA_ENGINEER);
  });

  it("the correct native assistant still resolves for data_engineer_clickstream regardless of picker classification", () => {
    const resolved = resolveNativeCaseAssistant(DATA_ENGINEER, {
      VAPI_DATA_ENGINEER_ASSISTANT_ID: "de-assistant-id",
    });
    expect(resolved).toMatchObject({
      caseId: DATA_ENGINEER,
      assistantId: "de-assistant-id",
      assistantConfigVersion: "data-engineer-clickstream-assistant-v1",
    });
  });
});
