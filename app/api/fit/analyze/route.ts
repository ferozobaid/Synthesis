import { NextRequest, NextResponse } from "next/server";
import { parseJD } from "@/lib/parsers/jd-parser";
import { parseResume } from "@/lib/parsers/resume-parser";
import { scoreFitAnalyzer } from "@/lib/matching-semantic";
import { useMocks } from "@/lib/config";

// POST /api/fit/analyze  { resumeText, jdText }
// Runs the real O*NET-grounded fit pipeline. When local embeddings are enabled,
// the analyzer returns the pre-specified hybrid_0_25 score; otherwise it falls
// back to deterministic rules-only scoring. `mock` only flags missing app
// credentials (nothing is persisted).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const resumeText: string = body.resumeText ?? "";
  const jdText: string = body.jdText ?? "";

  const jd = parseJD(jdText);
  const resume = parseResume(resumeText);
  const scoring = await scoreFitAnalyzer(resume, jd);

  return NextResponse.json({
    mock: useMocks(),
    report: scoring.report,
    scoring: {
      method: scoring.method,
      structured_weight: scoring.structured_weight,
      semantic_weight: scoring.semantic_weight,
      embeddings_enabled: scoring.embeddings_enabled,
      embedding_backend: scoring.embedding_backend,
      fallback_reason: scoring.fallback_reason ?? null,
    },
    jd: {
      company: jd.company,
      role_title: jd.role_title,
      seniority: jd.seniority,
      domain: jd.domain,
      must_have_count: jd.must_have.length,
      nice_to_have_count: jd.nice_to_have.length,
    },
    resume_skills: resume.skills,
  });
}
