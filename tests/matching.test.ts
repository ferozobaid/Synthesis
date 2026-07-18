import { afterEach, describe, it, expect, vi } from "vitest";
import type { NextRequest } from "next/server";
import { scoreFit } from "@/lib/matching";
import { scoreFitAnalyzer, scoreFitHybrid } from "@/lib/matching-semantic";
import { parseResume } from "@/lib/parsers/resume-parser";
import { parseJD } from "@/lib/parsers/jd-parser";
import { EMBEDDING_DIM, type FitReport } from "@/lib/types";
import { setEmbeddingLoaderForTests } from "@/lib/embeddings";
import { POST as fitAnalyzePOST } from "@/app/api/fit/analyze/route";

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

let restoreEmbeddingLoader: (() => void) | null = null;

afterEach(() => {
  restoreEmbeddingLoader?.();
  restoreEmbeddingLoader = null;
  vi.restoreAllMocks();
});

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
      expect(result.embedding_backend).toBe("disabled");
      expect(result.semantic).toBeNull();
      expect(result.report.overall_score).toBe(result.structured.overall_score);
      expect(result.structured_weight).toBe(1);
      expect(result.semantic_weight).toBe(0);
      expect(result.fallback_reason).toBe("EMBEDDINGS_ENABLED is not true");
    } finally {
      if (prev === undefined) delete process.env.EMBEDDINGS_ENABLED;
      else process.env.EMBEDDINGS_ENABLED = prev;
    }
  });

  it("falls back to structured scoring when strict BGE loading fails", async () => {
    const prev = process.env.EMBEDDINGS_ENABLED;
    process.env.EMBEDDINGS_ENABLED = "true";
    restoreEmbeddingLoader = setEmbeddingLoaderForTests(async () => {
      throw new Error("model unavailable");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = await scoreFitAnalyzer(parseResume(RESUME), parseJD(JD));
      expect(result.method).toBe("structured");
      expect(result.embedding_backend).toBe("failed");
      expect(result.embedding_model).toBe("Xenova/bge-small-en-v1.5");
      expect(result.embedding_failure_category).toBe("load");
      expect(result.semantic).toBeNull();
      expect(result.report).toEqual(result.structured);
      expect(result.structured_weight).toBe(1);
      expect(result.semantic_weight).toBe(0);
      expect(result.fallback_reason).toBe(
        "Local BGE embeddings could not be loaded; using structured scoring.",
      );
      expect(warn).toHaveBeenCalledWith(
        "[fit] BGE embedding load failed; using structured scoring.",
      );
    } finally {
      if (prev === undefined) delete process.env.EMBEDDINGS_ENABLED;
      else process.env.EMBEDDINGS_ENABLED = prev;
    }
  });

  it("falls back to structured scoring when strict BGE inference fails", async () => {
    const prev = process.env.EMBEDDINGS_ENABLED;
    process.env.EMBEDDINGS_ENABLED = "true";
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    restoreEmbeddingLoader = setEmbeddingLoaderForTests(async () => async () => {
      throw new Error("tensor failed");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = await scoreFitAnalyzer(parseResume(RESUME), parseJD(JD));
      expect(result.method).toBe("structured");
      expect(result.embedding_backend).toBe("failed");
      expect(result.embedding_failure_category).toBe("inference");
      expect(result.semantic).toBeNull();
      expect(result.report).toEqual(result.structured);
      expect(result.structured_weight).toBe(1);
      expect(result.semantic_weight).toBe(0);
      expect(result.fallback_reason).toBe(
        "Local BGE embedding inference failed; using structured scoring.",
      );
      expect(warn).toHaveBeenCalledWith(
        "[fit] BGE embedding inference failed; using structured scoring.",
      );
    } finally {
      if (prev === undefined) delete process.env.EMBEDDINGS_ENABLED;
      else process.env.EMBEDDINGS_ENABLED = prev;
    }
  });

  it("returns hybrid_0_25 when strict BGE load and inference succeeds", async () => {
    const prev = process.env.EMBEDDINGS_ENABLED;
    process.env.EMBEDDINGS_ENABLED = "true";
    vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    restoreEmbeddingLoader = setEmbeddingLoaderForTests(async () => async () => {
      const data = new Float32Array(EMBEDDING_DIM);
      data[calls++ % EMBEDDING_DIM] = 1;
      return { data };
    });

    try {
      const result = await scoreFitAnalyzer(parseResume(RESUME), parseJD(JD));
      expect(result.method).toBe("hybrid_0_25");
      expect(result.embedding_backend).toBe("bge");
      expect(result.semantic).not.toBeNull();
      expect(result.structured_weight).toBe(0.25);
      expect(result.semantic_weight).toBe(0.75);
      expect(result.fallback_reason).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
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

describe("fit analyzer API compatibility", () => {
  it("preserves scoring shape and includes embedding_backend", async () => {
    const prev = process.env.EMBEDDINGS_ENABLED;
    process.env.EMBEDDINGS_ENABLED = "false";
    try {
      const req = new Request("http://localhost/api/fit/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: RESUME, jdText: JD }),
      });
      const response = await fitAnalyzePOST(req as unknown as NextRequest);
      const body = await response.json();

      expect(body).toHaveProperty("mock");
      expect(body).toHaveProperty("report");
      expect(body).toHaveProperty("scoring");
      expect(body).toHaveProperty("jd");
      expect(body).toHaveProperty("resume_skills");
      expect(body.scoring).toMatchObject({
        method: "structured",
        structured_weight: 1,
        semantic_weight: 0,
        embeddings_enabled: false,
        embedding_backend: "disabled",
        embedding_model: "none",
        embedding_failure_category: null,
        fallback_reason: "EMBEDDINGS_ENABLED is not true",
      });
    } finally {
      if (prev === undefined) delete process.env.EMBEDDINGS_ENABLED;
      else process.env.EMBEDDINGS_ENABLED = prev;
    }
  });

  it("includes embedding_backend for the hybrid BGE success response", async () => {
    const prev = process.env.EMBEDDINGS_ENABLED;
    process.env.EMBEDDINGS_ENABLED = "true";
    vi.spyOn(console, "info").mockImplementation(() => {});
    let calls = 0;
    restoreEmbeddingLoader = setEmbeddingLoaderForTests(async () => async () => {
      const data = new Float32Array(EMBEDDING_DIM);
      data[calls++ % EMBEDDING_DIM] = 1;
      return { data };
    });
    try {
      const req = new Request("http://localhost/api/fit/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: RESUME, jdText: JD }),
      });
      const response = await fitAnalyzePOST(req as unknown as NextRequest);
      const body = await response.json();

      expect(body.scoring).toMatchObject({
        method: "hybrid_0_25",
        structured_weight: 0.25,
        semantic_weight: 0.75,
        embeddings_enabled: true,
        embedding_backend: "bge",
        embedding_model: "Xenova/bge-small-en-v1.5",
        embedding_failure_category: null,
        fallback_reason: null,
      });
    } finally {
      if (prev === undefined) delete process.env.EMBEDDINGS_ENABLED;
      else process.env.EMBEDDINGS_ENABLED = prev;
    }
  });
});
