import { NextRequest, NextResponse } from "next/server";
import { parseJD } from "@/lib/parsers/jd-parser";
import { parseResume } from "@/lib/parsers/resume-parser";
import { useMocks } from "@/lib/config";
import { mockFitReport } from "@/lib/__mocks__/fixtures";

// POST /api/fit/analyze  { resumeText, jdText }
// Runs the real shared parsers; returns a fit report. Real embedding+rule scoring
// lands in Module 1 — on mocks this returns a representative report.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const resumeText: string = body.resumeText ?? "";
  const jdText: string = body.jdText ?? "";

  const jd = parseJD(jdText);
  const resume = parseResume(resumeText);

  return NextResponse.json({
    mock: useMocks(),
    report: mockFitReport,
    jd: {
      company: jd.company,
      role_title: jd.role_title,
      must_have_count: jd.must_have.length,
      nice_to_have_count: jd.nice_to_have.length,
    },
    resume_skills: resume.skills,
  });
}
