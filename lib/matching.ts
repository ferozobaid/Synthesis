/**
 * Fit matching engine — LIVE PLANE, fully deterministic.
 *
 * Scores a parsed resume against parsed JD requirements, grounded in the
 * committed O*NET taxonomy (via lib/onet). Every JD requirement is classified
 * matched / partial / missing with the resume evidence that backs the decision,
 * then aggregated into a weighted 0–100 score with gaps, missing keywords and
 * prioritised recommendations.
 *
 * No Claude, no embeddings, no centralized database: parsing + matching are
 * pure functions, so this produces real scores in mock mode (no credentials)
 * and in tests.
 */
import type {
  FitReport,
  JDRequirement,
  JDRequirements,
  ParsedResume,
  PerRequirementResult,
  RequirementStatus,
} from "@/lib/types";
import { extractCanonicalSkills, matchOccupation, relatedSkills } from "@/lib/onet";

const WEIGHT = { must_have: 1.0, nice_to_have: 0.4 } as const;

const STOPWORDS = new Set([
  "the", "and", "with", "for", "you", "our", "are", "will", "this", "that",
  "have", "has", "your", "their", "from", "must", "should", "able", "work",
  "working", "including", "experience", "strong", "using", "use", "across",
  "within", "into", "they", "them", "who", "what", "when", "role", "team",
  "plus", "required", "preferred", "ability", "skills", "knowledge",
]);

interface Evidence {
  text: string;
  skills: Set<string>;
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

/** Tidy a requirement string for display (drop trailing punctuation/whitespace). */
function label(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[.;,:]\s*$/, "").trim();
}

function shorten(text: string, n = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/** A resume skill is "related" to S if either points at the other in the taxonomy. */
function hasRelated(skill: string, resumeSkills: Set<string>): boolean {
  if (relatedSkills(skill).some((r) => resumeSkills.has(r))) return true;
  for (const rs of resumeSkills) if (relatedSkills(rs).includes(skill)) return true;
  return false;
}

/** Experience bullet that demonstrates one of the covered skills, preferring a
 *  bullet not already cited by another requirement so evidence doesn't repeat. */
function findEvidence(covered: string[], bullets: Evidence[], used: Set<string>): string | null {
  let fallback: string | null = null;
  for (const b of bullets) {
    if (!covered.some((s) => b.skills.has(s))) continue;
    const t = shorten(b.text);
    if (!used.has(t)) {
      used.add(t);
      return t;
    }
    if (fallback === null) fallback = t;
  }
  return fallback;
}

/** Keyword overlap of a requirement against the resume free text (0..1) + evidence. */
function keywordOverlap(text: string, bullets: Evidence[], rawLower: string): {
  ratio: number;
  evidence: string | null;
} {
  const words = [...new Set(
    text.toLowerCase().match(/[a-z][a-z+#.]{2,}/g)?.filter((w) => !STOPWORDS.has(w)) ?? [],
  )];
  if (!words.length) return { ratio: 0, evidence: null };
  const present = words.filter((w) => rawLower.includes(w));
  const ratio = present.length / words.length;
  let evidence: string | null = null;
  if (present.length) {
    const hit = bullets.find((b) => present.some((w) => b.text.toLowerCase().includes(w)));
    evidence = hit ? shorten(hit.text) : null;
  }
  return { ratio, evidence };
}

function mk(
  text: string,
  weight: number,
  status: RequirementStatus,
  score: number,
  evidence: string | null,
): PerRequirementResult {
  return { requirement: label(text), status, evidence: status === "missing" ? null : evidence, weight, score };
}

const EDU_RE = /\b(degree|bachelor|master|phd|mba|bsc|b\.?s\.?|m\.?s\.?|diploma|graduate|undergraduate)\b/i;

// --------------------------------------------------------------------------- //
// Per-requirement evaluation
// --------------------------------------------------------------------------- //
function evaluate(
  r: JDRequirement,
  weight: number,
  resume: ParsedResume,
  resumeSkills: Set<string>,
  bullets: Evidence[],
  rawLower: string,
  used: Set<string>,
): PerRequirementResult {
  // Education requirements: satisfied if the resume has any education entry.
  if (r.category === "education" || EDU_RE.test(r.text)) {
    if (resume.education.length > 0) {
      return mk(r.text, weight, "matched", 0.9, resume.education[0].degree ?? null);
    }
    return mk(r.text, weight, "missing", 0.05, null);
  }

  const reqSkills = extractCanonicalSkills(r.text);
  if (reqSkills.length > 0) {
    const direct = reqSkills.filter((s) => resumeSkills.has(s));
    const related = reqSkills.filter((s) => !resumeSkills.has(s) && hasRelated(s, resumeSkills));
    const isOr = /\bor\b/i.test(r.text) && reqSkills.length > 1;

    // Coverage: direct hits count full, related hits count 0.6. OR => any one suffices.
    let coverage: number;
    if (isOr) {
      coverage = direct.length > 0 ? 1 : related.length > 0 ? 0.6 : 0;
    } else {
      coverage = (direct.length + 0.6 * related.length) / reqSkills.length;
    }

    let status: RequirementStatus;
    let score: number;
    if (coverage >= 0.85) {
      status = "matched";
      score = 0.85 + 0.1 * Math.min(1, direct.length / reqSkills.length);
    } else if (coverage >= 0.3) {
      status = "partial";
      score = 0.4 + 0.3 * coverage;
    } else {
      status = "missing";
      score = 0.05;
    }
    const evidence = status === "missing" ? null : findEvidence([...direct, ...related], bullets, used);
    return mk(r.text, weight, status, score, evidence);
  }

  // Generic / responsibility requirement: fall back to keyword overlap.
  const { ratio, evidence } = keywordOverlap(r.text, bullets, rawLower);
  if (ratio >= 0.6) return mk(r.text, weight, "matched", 0.8, evidence);
  if (ratio >= 0.3) return mk(r.text, weight, "partial", 0.5, evidence);
  return mk(r.text, weight, "missing", 0.08, null);
}

// --------------------------------------------------------------------------- //
// Top-level scoring
// --------------------------------------------------------------------------- //
export function scoreFit(resume: ParsedResume, jd: JDRequirements): FitReport {
  const resumeSkills = new Set(resume.skills);

  const bullets: Evidence[] = [];
  for (const exp of resume.experience) {
    for (const b of exp.bullets) bullets.push({ text: b, skills: new Set(extractCanonicalSkills(b)) });
  }
  const rawLower = resume.raw_text.toLowerCase();
  const usedEvidence = new Set<string>();

  const weighted = [
    ...jd.must_have.map((r) => ({ r, weight: WEIGHT.must_have })),
    ...jd.nice_to_have.map((r) => ({ r, weight: WEIGHT.nice_to_have })),
  ];

  const per_requirement = weighted.map(({ r, weight }) =>
    evaluate(r, weight, resume, resumeSkills, bullets, rawLower, usedEvidence),
  );

  const totalW = per_requirement.reduce((a, p) => a + p.weight, 0);
  const overall_score =
    totalW > 0
      ? Math.round((100 * per_requirement.reduce((a, p) => a + p.weight * p.score, 0)) / totalW)
      : 0;

  // ---- Strengths: matched requirements, must-haves first, deduped by skill ---- //
  const top_strengths: string[] = [];
  const usedStrength = new Set<string>();
  for (const { idx } of per_requirement
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.status === "matched")
    .sort((a, b) => b.p.weight * b.p.score - a.p.weight * a.p.score)) {
    const p = per_requirement[idx];
    const skill = extractCanonicalSkills(p.requirement)[0];
    const key = skill ?? p.requirement;
    if (usedStrength.has(key)) continue;
    usedStrength.add(key);
    top_strengths.push(p.evidence ? `${skill ?? label(p.requirement)} — ${p.evidence}` : label(p.requirement));
    if (top_strengths.length >= 4) break;
  }

  // ---- Gaps: must-have misses/partials first, then notable nice-to-have misses -- //
  const gaps: string[] = [];
  for (const p of per_requirement) {
    if (p.weight === WEIGHT.must_have && p.status !== "matched") {
      gaps.push(
        p.status === "missing"
          ? `${label(p.requirement)} — required but not found in your resume.`
          : `${label(p.requirement)} — only partially evidenced.`,
      );
    }
  }
  for (const p of per_requirement) {
    if (gaps.length >= 5) break;
    if (p.weight !== WEIGHT.must_have && p.status === "missing") {
      gaps.push(`${label(p.requirement)} — listed as a plus, not present.`);
    }
  }

  // ---- Missing keywords: required canonical skills + role tools absent from resume -- //
  const reqSkillSet: string[] = [];
  for (const r of [...jd.must_have, ...jd.nice_to_have]) {
    for (const s of extractCanonicalSkills(r.text)) if (!reqSkillSet.includes(s)) reqSkillSet.push(s);
  }
  const occ = matchOccupation(jd.role_title);
  const occTools = occ ? occ.tools : [];
  const missing_keywords: string[] = [];
  for (const s of [...reqSkillSet, ...occTools]) {
    if (!resumeSkills.has(s) && !missing_keywords.includes(s)) missing_keywords.push(s);
    if (missing_keywords.length >= 8) break;
  }

  // ---- Recommendations: specific + prioritised (must-haves first) ---- //
  const recommendations: string[] = [];
  const pushRec = (s: string) => {
    if (recommendations.length < 6 && !recommendations.includes(s)) recommendations.push(s);
  };
  const primarySkill = (r: JDRequirement) => r.onet_skill ?? extractCanonicalSkills(r.text)[0] ?? null;

  for (const r of jd.must_have) {
    const res = per_requirement.find((p) => p.requirement === label(r.text));
    if (!res || res.status === "matched") continue;
    const skill = primarySkill(r);
    if (r.category === "education" || EDU_RE.test(r.text)) {
      pushRec(`The JD requires ${shorten(label(r.text), 60)}; make your education section reflect it.`);
    } else if (skill) {
      pushRec(
        res.status === "missing"
          ? `Add a project or bullet demonstrating ${skill} — the JD lists it as a must-have and it isn't in your resume.`
          : `Strengthen ${skill} — it's referenced but not backed by a concrete, quantified result.`,
      );
    } else {
      pushRec(`Address the must-have "${shorten(label(r.text), 70)}" — it isn't evidenced in your resume.`);
    }
  }
  for (const r of jd.nice_to_have) {
    const res = per_requirement.find((p) => p.requirement === label(r.text));
    if (!res || res.status === "matched") continue;
    const skill = primarySkill(r);
    if (skill) pushRec(`Consider surfacing any ${skill} exposure — the JD lists it as a plus.`);
  }

  return {
    overall_score,
    per_requirement,
    top_strengths,
    gaps,
    missing_keywords,
    recommendations,
  };
}
