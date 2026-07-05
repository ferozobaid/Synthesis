import { describe, it, expect } from "vitest";
import { scoreFit } from "@/lib/matching";
import { scoreFitAnalyzer, scoreFitHybrid } from "@/lib/matching-semantic";
import { parseResume } from "@/lib/parsers/resume-parser";
import { parseJD } from "@/lib/parsers/jd-parser";
import type { FitReport } from "@/lib/types";

const RESUME = `JANE DOE
EXPERIENCE
Analyst, Retail Co
- Built reporting in SQL across regions
- Automated analysis in Python (pandas)
- Designed Power BI dashboards
EDUCATION
BSc, Business Analytics`;

const JD = `Title: Data Analyst
Required: strong SQL and Python; data visualization. Statistical analysis is essential.
A Bachelor's degree is required. Experience with cybersecurity is a plus.`;

describe("matching — classification & scoring", () => {
  it("matches a skill present in the resume, with evidence", () => {
    const sql = scoreFit(parseResume(RESUME), parseJD(JD)).per_requirement.find((p) => /SQL/i.test(p.requirement));
    expect(sql?.status).toBe("matched");
    expect(sql?.evidence).toBeTruthy();
  });

  it("marks a skill absent from the resume as missing, no evidence", () => {
    const stats = scoreFit(parseResume(RESUME), parseJD(JD)).per_requirement.find((p) => /statistical/i.test(p.requirement));
    expect(stats?.status).toBe("missing");
    expect(stats?.evidence).toBeNull();
  });

  it("matches the education requirement against the resume degree", () => {
    const edu = scoreFit(parseResume(RESUME), parseJD(JD)).per_requirement.find((p) => /bachelor/i.test(p.requirement));
    expect(edu?.status).toBe("matched");
    expect(edu?.evidence).toMatch(/BSc/);
  });

  it("produces a 0..100 overall score", () => {
    const score = scoreFit(parseResume(RESUME), parseJD(JD)).overall_score;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("weights must-haves above nice-to-haves", () => {
    const resume = parseResume(RESUME); // has SQL, lacks Kubernetes
    const missMust = scoreFit(resume, parseJD("SQL is required. Kubernetes is required.")).overall_score;
    const missNice = scoreFit(resume, parseJD("SQL is required. Kubernetes is a plus.")).overall_score;
    expect(missNice).toBeGreaterThan(missMust);
  });

  it("recommends adding the missing must-have skill, specifically", () => {
    const recs = scoreFit(parseResume(RESUME), parseJD(JD)).recommendations;
    expect(recs.some((r) => /statistic/i.test(r))).toBe(true);
  });

  it("surfaces matched skills as strengths", () => {
    expect(scoreFit(parseResume(RESUME), parseJD(JD)).top_strengths.length).toBeGreaterThan(0);
  });

  it("lists required-but-absent skills as missing keywords", () => {
    expect(scoreFit(parseResume(RESUME), parseJD(JD)).missing_keywords).toEqual(
      expect.arrayContaining(["Statistics"]),
    );
  });
});

describe("matching — edge cases", () => {
  it("empty resume → low score, every requirement missing", () => {
    const r = scoreFit(parseResume(""), parseJD(JD));
    expect(r.overall_score).toBeLessThan(20);
    expect(r.per_requirement.length).toBeGreaterThan(0);
    expect(r.per_requirement.every((p) => p.status === "missing")).toBe(true);
  });

  it("JD with no recognizable requirements → score 0, no NaN, no crash", () => {
    const r = scoreFit(parseResume(RESUME), parseJD("Hello there. Welcome aboard."));
    expect(Number.isFinite(r.overall_score)).toBe(true);
    expect(r.overall_score).toBe(0);
    expect(r.per_requirement).toEqual([]);
  });

  it("resume with no matching skills → nothing matched", () => {
    const r = scoreFit(parseResume("Pastry chef. Ran a bakery for 8 years."), parseJD(JD));
    expect(r.per_requirement.some((p) => p.status === "matched")).toBe(false);
  });
});

describe("fit analyzer production method", () => {
  it("falls back to structured scoring when embeddings are disabled", async () => {
    const prev = process.env.EMBEDDINGS_ENABLED;
    process.env.EMBEDDINGS_ENABLED = "false";
    try {
      const result = await scoreFitAnalyzer(parseResume(RESUME), parseJD(JD));
      expect(result.method).toBe("structured");
      expect(result.semantic).toBeNull();
      expect(result.report.overall_score).toBe(result.structured.overall_score);
    } finally {
      if (prev === undefined) delete process.env.EMBEDDINGS_ENABLED;
      else process.env.EMBEDDINGS_ENABLED = prev;
    }
  });

  it("blends structured and semantic reports with the hybrid_0_25 ratio", () => {
    const base: FitReport = {
      overall_score: 40,
      per_requirement: [
        { requirement: "SQL", status: "missing", evidence: null, weight: 1, score: 0.2 },
      ],
      top_strengths: ["rules strength"],
      gaps: ["rules gap"],
      missing_keywords: ["SQL"],
      recommendations: ["rules rec"],
    };
    const semantic: FitReport = {
      overall_score: 80,
      per_requirement: [
        { requirement: "SQL", status: "matched", evidence: "semantic evidence", weight: 1, score: 0.9 },
      ],
      top_strengths: ["semantic strength"],
      gaps: [],
      missing_keywords: [],
      recommendations: ["semantic rec"],
    };
    const hybrid = scoreFitHybrid(base, semantic, 0.25);
    expect(hybrid.overall_score).toBe(70);
    expect(hybrid.per_requirement[0].score).toBeCloseTo(0.725);
    expect(hybrid.per_requirement[0].evidence).toBe("semantic evidence");
  });
});
