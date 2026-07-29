import { describe, expect, it } from "vitest";

import {
  ARM_LABEL_THRESHOLDS,
  ARM_NAMES,
  COMPARISON_HEADERS,
  HUMAN_LABELS,
  REVIEW_HEADERS,
  SELECTION_BANDS,
  STUDY_FAMILIES,
  armLabel,
  humanLabelFromRubric,
  parseCsvText,
  selectFinalPairs,
} from "@/scripts/validation/human_validation_54";

describe("54-pair human validation", () => {
  it("keeps the review and comparison files limited to the scored rubric and labels", () => {
    const removedColumns = [
      "confidence_1_to_3",
      "key_matching_evidence",
      "critical_gap",
      "reviewer_note",
    ];

    expect(REVIEW_HEADERS).not.toEqual(expect.arrayContaining(removedColumns));
    expect(COMPARISON_HEADERS).not.toEqual(expect.arrayContaining(removedColumns));
  });

  it("uses the frozen three-label mapping and documents the collapsed top product bands", () => {
    expect(ARM_NAMES).toEqual([
      "structured",
      "embedding",
      "hybrid_0_25",
      "hybrid_0_5",
      "hybrid_0_75",
    ]);
    expect(HUMAN_LABELS).toEqual(["WEAK", "MEDIUM", "STRONG"]);
    expect(armLabel(44)).toBe("WEAK");
    expect(armLabel(45)).toBe("MEDIUM");
    expect(armLabel(64)).toBe("MEDIUM");
    expect(armLabel(65)).toBe("STRONG");
    expect(armLabel(80)).toBe("STRONG");
    expect(ARM_LABEL_THRESHOLDS.source).toContain("65-79 and 80+");
    expect(ARM_LABEL_THRESHOLDS.source).toContain("combined as STRONG");
  });

  it("derives human labels from the four-dimension rubric and applies the gating cap", () => {
    expect(humanLabelFromRubric(2, 2)).toBe("WEAK");
    expect(humanLabelFromRubric(3, 1)).toBe("MEDIUM");
    expect(humanLabelFromRubric(6, 1)).toBe("STRONG");
    expect(humanLabelFromRubric(8, 0)).toBe("MEDIUM");
  });

  it("parses quoted commas, quotes, and newlines in reviewer CSV content", () => {
    const rows = parseCsvText(
      'pair_id,resume,job_description\r\nPAIR-001,"Line one,\nline ""two""","JD, text"\r\n',
    );
    expect(rows).toEqual([
      {
        pair_id: "PAIR-001",
        resume: 'Line one,\nline "two"',
        job_description: "JD, text",
      },
    ]);
  });

  it("selects exactly six unique pairs per family and band with the frozen source-family quota", () => {
    const candidates = STUDY_FAMILIES.flatMap((family, familyIndex) =>
      SELECTION_BANDS.flatMap((selectionBand, bandIndex) => [
        ...Array.from({ length: 4 }, (_, index) => {
          const id = `${familyIndex}-${bandIndex}-same-${index}`;
          return {
            resume: { id: `resume-${id}`, category: family, raw_text: "", parsed: {} },
            jd: {
              job_id: `jd-${id}`,
              family,
              title: "",
              company_name: "",
              posting_text: "",
              parsed: {},
            },
            scores: {
              structured: 10,
              embedding: 20,
              hybrid_0_25: 18,
              hybrid_0_5: 15,
              hybrid_0_75: 12,
            },
            percentiles: {
              structured: 0,
              embedding: 0,
              hybrid_0_25: 0,
              hybrid_0_5: 0,
              hybrid_0_75: 0,
            },
            composite_percentile: bandIndex / 2,
            selection_band: selectionBand,
            score_range: 10,
          };
        }),
        ...Array.from({ length: 2 }, (_, index) => {
          const id = `${familyIndex}-${bandIndex}-cross-${index}`;
          const crossFamily = STUDY_FAMILIES[(familyIndex + 1) % STUDY_FAMILIES.length];
          return {
            resume: { id: `resume-${id}`, category: crossFamily, raw_text: "", parsed: {} },
            jd: {
              job_id: `jd-${id}`,
              family,
              title: "",
              company_name: "",
              posting_text: "",
              parsed: {},
            },
            scores: {
              structured: 10,
              embedding: 20,
              hybrid_0_25: 18,
              hybrid_0_5: 15,
              hybrid_0_75: 12,
            },
            percentiles: {
              structured: 0,
              embedding: 0,
              hybrid_0_25: 0,
              hybrid_0_5: 0,
              hybrid_0_75: 0,
            },
            composite_percentile: bandIndex / 2,
            selection_band: selectionBand,
            score_range: 10,
          };
        }),
      ]),
    );

    const selected = selectFinalPairs(candidates as never[]);
    expect(selected).toHaveLength(54);
    expect(new Set(selected.map((pair) => pair.resume.id)).size).toBe(54);
    expect(new Set(selected.map((pair) => pair.jd.job_id)).size).toBe(54);
    for (const family of STUDY_FAMILIES) {
      for (const band of SELECTION_BANDS) {
        const stratum = selected.filter(
          (pair) => pair.jd.family === family && pair.selection_band === band,
        );
        expect(stratum).toHaveLength(6);
        expect(stratum.filter((pair) => pair.resume.category === family)).toHaveLength(4);
      }
    }
  });
});
