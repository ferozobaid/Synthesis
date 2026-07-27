import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_DURATION_SECONDS,
  PREVIEW_LLM_CASES,
  caseMaxDurationSeconds,
  type CaseDifficultyStars,
} from "@/lib/voice/case-catalog";
import { GET as catalogGET } from "@/app/api/case/catalog/route";

const SUPPORTED_STARS: CaseDifficultyStars[] = [3, 4, 5];

/** The locked assignment. A change here must be a deliberate product decision. */
const EXPECTED: Record<string, { stars: CaseDifficultyStars; seconds: number }> = {
  airport_profitability: { stars: 3, seconds: 600 },
  gcc_premium_gym_market_entry: { stars: 4, seconds: 900 },
  data_engineer_clickstream: { stars: 5, seconds: 1200 },
  data_analyst_technical_round: { stars: 5, seconds: 1200 },
  data_engineer_technical_round: { stars: 5, seconds: 1200 },
};

describe("case difficulty configuration", () => {
  it("maps the three supported ratings to 10 / 15 / 20 minutes", () => {
    expect(DIFFICULTY_DURATION_SECONDS).toEqual({ 3: 600, 4: 900, 5: 1200 });
  });

  it("gives every catalog case a supported difficulty and a derived duration", () => {
    expect(PREVIEW_LLM_CASES.length).toBeGreaterThan(0);
    for (const entry of PREVIEW_LLM_CASES) {
      expect(SUPPORTED_STARS, entry.id).toContain(entry.difficultyStars);
      // Duration is DERIVED, never authored separately.
      expect(caseMaxDurationSeconds(entry.id), entry.id).toBe(
        DIFFICULTY_DURATION_SECONDS[entry.difficultyStars],
      );
    }
  });

  it("carries the exact assigned rating for each of the five cases", () => {
    expect(PREVIEW_LLM_CASES.map((entry) => entry.id).sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );
    for (const [caseId, expected] of Object.entries(EXPECTED)) {
      const entry = PREVIEW_LLM_CASES.find((item) => item.id === caseId);
      expect(entry?.difficultyStars, caseId).toBe(expected.stars);
      expect(caseMaxDurationSeconds(caseId), caseId).toBe(expected.seconds);
    }
  });

  it("has no duration for an unknown case id", () => {
    expect(caseMaxDurationSeconds("not_a_case")).toBeNull();
  });

  it("exposes difficulty and derived duration through the catalog endpoint", async () => {
    const body = (await (await catalogGET()).json()) as {
      cases: { id: string; difficultyStars: number; maxDurationSeconds: number }[];
    };
    for (const entry of body.cases) {
      const expected = EXPECTED[entry.id];
      expect(expected, entry.id).toBeDefined();
      expect(entry.difficultyStars, entry.id).toBe(expected.stars);
      expect(entry.maxDurationSeconds, entry.id).toBe(expected.seconds);
    }
  });
});
