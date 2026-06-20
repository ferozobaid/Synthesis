#!/usr/bin/env python3
"""
Validation data prep — OFFLINE PLANE.

Turns the two gitignored corpora into clean JSON artifacts the TypeScript scorer
(`score_resumes.ts`) can read without any CSV parsing:

  1. ``.artifacts/resumes.jsonl``      — one {id, category, raw_text} per retained resume.
  2. ``field_profiles.json`` (committed) — one synthetic JD per retained family, built
     by mapping postings -> family (family_map.py) and aggregating their skills +
     requirement-cue sentences. This is what each resume is scored against.

Data prep follows the EDA: drop the 3 under-populated resume families
(family_map.DROPPED_FAMILIES) and corrupt/empty resume rows; de-duplicate the
~15.3% posting reposts. Resume text cleaning (full-width dash, "Company Name"
100%-leak, ALL-CAPS title 99.5%-leak) is applied downstream by the LIVE engine's
``parseResume`` (lib/parsers/resume-parser.ts), so the harness validates the real
cleaning path rather than a copy.

Run:  python3 scripts/validation/prepare_data.py
"""

from __future__ import annotations

import json
import os
import re
import sys

import pandas as pd

from family_map import DROPPED_FAMILIES, RETAINED_FAMILIES, map_title

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ART = os.path.join(HERE, ".artifacts")

RESUME_CSV = os.path.join(REPO, "Datasets", "archive", "Resume", "Resume.csv")
POSTINGS_CSV = os.path.join(REPO, "Datasets", "archive-2", "postings.csv")
JOB_SKILLS_CSV = os.path.join(REPO, "Datasets", "archive-2", "jobs", "job_skills.csv")
SKILLS_CSV = os.path.join(REPO, "Datasets", "archive-2", "mappings", "skills.csv")

PROFILE_OUT = os.path.join(HERE, "field_profiles.json")
RESUME_OUT = os.path.join(ART, "resumes.jsonl")

MIN_RESUME_CHARS = 50          # corrupt/empty guard
TOP_SKILLS_PER_FAMILY = 15
MAX_REQ_LINES_PER_FAMILY = 30
SAMPLE_POSTINGS_PER_FAMILY = 600  # cap description scanning per family for speed

# Requirement-cue sentences worth keeping for a field profile (mirrors the JD parser's cues).
REQ_CUE = re.compile(
    r"(experience|skill|proficien|degree|bachelor|knowledge|ability|familiar|"
    r"required|preferred|years|must|plus|communication|analy|manage|develop)",
    re.I,
)


def _require(path: str) -> None:
    if not os.path.exists(path):
        sys.exit(
            f"Missing dataset: {path}\n"
            "This is the offline validation harness; it needs the local (gitignored) "
            "Datasets/. See scripts/validation/README.md."
        )


# --------------------------------------------------------------------------- #
# Resumes
# --------------------------------------------------------------------------- #
def prepare_resumes() -> dict[str, int]:
    df = pd.read_csv(RESUME_CSV, dtype=str).fillna("")
    total = len(df)
    df = df[~df["Category"].isin(DROPPED_FAMILIES)]
    dropped_family = total - len(df)
    df["Resume_str"] = df["Resume_str"].str.strip()
    before = len(df)
    df = df[df["Resume_str"].str.len() >= MIN_RESUME_CHARS]
    dropped_corrupt = before - len(df)

    os.makedirs(ART, exist_ok=True)
    with open(RESUME_OUT, "w", encoding="utf-8") as fh:
        for _, r in df.iterrows():
            fh.write(json.dumps({"id": r["ID"], "category": r["Category"],
                                 "raw_text": r["Resume_str"]}, ensure_ascii=False) + "\n")

    print(f"  resumes: {total} -> {len(df)} kept "
          f"(dropped {dropped_family} in {DROPPED_FAMILIES}, {dropped_corrupt} corrupt/short)")
    print(f"  families retained: {df['Category'].nunique()}")
    return {"total": total, "kept": len(df)}


# --------------------------------------------------------------------------- #
# Field profiles from postings
# --------------------------------------------------------------------------- #
def _skill_lookup() -> dict[str, str]:
    skills = pd.read_csv(SKILLS_CSV, dtype=str).fillna("")
    return dict(zip(skills["skill_abr"], skills["skill_name"]))


def _split_sentences(text: str) -> list[str]:
    text = re.sub(r"<[^>]+>", " ", str(text))           # strip any HTML
    text = re.sub(r"\s+", " ", text)
    return re.split(r"(?<=[.;:])\s+|\n|•|•", text)


def prepare_field_profiles() -> dict[str, int]:
    cols = ["job_id", "company_name", "title", "description"]
    posts = pd.read_csv(POSTINGS_CSV, usecols=cols, dtype=str).fillna("")
    raw = len(posts)

    # De-duplicate reposts (~15.3% per EDA).
    posts = posts.drop_duplicates(subset=["title", "company_name", "description"])
    deduped = raw - len(posts)

    posts["family"] = posts["title"].map(map_title)
    mapped = posts[posts["family"].notna()].copy()
    coverage = len(mapped) / max(1, len(posts))

    # Skills per job, resolved to names.
    abr_to_name = _skill_lookup()
    job_skills = pd.read_csv(JOB_SKILLS_CSV, dtype=str).fillna("")
    job_skills["skill_name"] = job_skills["skill_abr"].map(abr_to_name).fillna("")
    skills_by_job: dict[str, list[str]] = (
        job_skills[job_skills["skill_name"] != ""]
        .groupby("job_id")["skill_name"].apply(list).to_dict()
    )

    profiles: dict[str, dict] = {}
    per_family_counts: dict[str, int] = {}
    for fam in RETAINED_FAMILIES:
        sub = mapped[mapped["family"] == fam]
        per_family_counts[fam] = len(sub)
        if sub.empty:
            continue

        # Top skills across this family's postings.
        skill_freq: dict[str, int] = {}
        for jid in sub["job_id"]:
            for s in skills_by_job.get(jid, []):
                skill_freq[s] = skill_freq.get(s, 0) + 1
        top_skills = [s for s, _ in sorted(skill_freq.items(), key=lambda kv: -kv[1])][:TOP_SKILLS_PER_FAMILY]

        # Representative requirement sentences (deduped, capped), from a sample of postings.
        seen: set[str] = set()
        req_lines: list[str] = []
        for desc in sub["description"].head(SAMPLE_POSTINGS_PER_FAMILY):
            for sent in _split_sentences(desc):
                s = sent.strip()
                if not (20 <= len(s) <= 180) or not REQ_CUE.search(s):
                    continue
                key = s.lower()[:60]
                if key in seen:
                    continue
                seen.add(key)
                req_lines.append(s)
                if len(req_lines) >= MAX_REQ_LINES_PER_FAMILY:
                    break
            if len(req_lines) >= MAX_REQ_LINES_PER_FAMILY:
                break

        readable = fam.replace("-", " ").title()
        profile_text = (
            f"Title: {readable}\nCompany: Field Profile\n\n"
            + "\n".join(req_lines)
            + ("\n\nRequired skills: " + ", ".join(top_skills) if top_skills else "")
        )
        profiles[fam] = {
            "family": fam,
            "title": readable,
            "postings_mapped": int(len(sub)),
            "top_skills": top_skills,
            "requirement_lines": req_lines,
            "profile_text": profile_text,
        }

    with open(PROFILE_OUT, "w", encoding="utf-8") as fh:
        json.dump({"generated_from": "Datasets/archive-2/postings.csv",
                   "families": profiles}, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"  postings: {raw} -> {len(posts)} after dedup ({deduped} reposts), "
          f"{len(mapped)} mapped to a family (coverage {coverage:.1%})")
    print(f"  profiles built: {len(profiles)}/{len(RETAINED_FAMILIES)} families")
    thin = {f: c for f, c in per_family_counts.items() if c < 50}
    if thin:
        print(f"  ⚠ thin families (<50 postings): {thin}")
    return {"profiles": len(profiles)}


def main() -> None:
    for p in (RESUME_CSV, POSTINGS_CSV, JOB_SKILLS_CSV, SKILLS_CSV):
        _require(p)
    print("Preparing validation data…")
    prepare_resumes()
    prepare_field_profiles()
    print(f"\nWrote:\n  {RESUME_OUT}\n  {PROFILE_OUT}")


if __name__ == "__main__":
    main()
