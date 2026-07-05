import { NextRequest, NextResponse } from "next/server";
import { parseJD } from "@/lib/parsers/jd-parser";
import { parseResume } from "@/lib/parsers/resume-parser";
import { scoreFit } from "@/lib/matching";
import { useMocks } from "@/lib/config";

// POST /api/fit/analyze  { resumeText, jdText }
// Runs the real, deterministic O*NET-grounded fit pipeline (parse → match → score).
// Parsing + matching need no Claude/Supabase, so this returns real scores in mock
// mode too; `mock` only flags that no credentials are set (nothing is persisted).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const resumeText: string = body.resumeText ?? "";
  const jdText: string = body.jdText ?? "";

  const jd = parseJD(jdText);
  const resume = parseResume(resumeText);
  const report = scoreFit(resume, jd);

  return NextResponse.json({
    mock: useMocks(),
    report,
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
