#!/usr/bin/env python3
"""
Scoped validation data prep - OFFLINE PLANE.

Builds a frozen validation split for the taxonomy-aligned families:
INFORMATION-TECHNOLOGY, FINANCE, and CONSULTANT.

Unlike the older field-profile harness, this script does not aggregate postings
or run Python requirement extraction. It writes raw resume text and real
posting-level JDs; the TypeScript scorer later routes them through the live
production parsers: parseResume() and parseJD().
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from family_map import map_title
from llm_family_map import (
    DEFAULT_MODEL,
    append_jsonl,
    classify_posting,
    clean_cell,
    load_dotenv,
    posting_cache_key,
    read_jsonl_cache,
)


HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
ART = HERE / ".artifacts"

RESUME_CSV = REPO / "Datasets" / "archive" / "Resume" / "Resume.csv"
POSTINGS_CSV = REPO / "Datasets" / "archive-2" / "postings.csv"

SCOPED_FAMILIES = ["INFORMATION-TECHNOLOGY", "FINANCE", "CONSULTANT"]
MIN_RESUME_CHARS = 50
MIN_DESCRIPTION_CHARS = 80

RESUMES_OUT = ART / "resumes.scoped.jsonl"
JDS_OUT = ART / "jds.scoped.jsonl"
CACHE_OUT = ART / "posting_family_map.jsonl"
REPORT_OUT = ART / "sampling_report.json"

SMOKE_RESUMES_OUT = ART / "resumes.smoke.jsonl"
SMOKE_JDS_OUT = ART / "jds.smoke.jsonl"
SMOKE_REPORT_OUT = ART / "sampling_report.smoke.json"


def require(path: Path) -> None:
    if not path.exists():
        raise SystemExit(
            f"Missing dataset: {path}\n"
            "This validation step needs the local gitignored Datasets/ files."
        )


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            n += 1
    return n


def prepare_resumes(path: Path = RESUMES_OUT) -> dict[str, Any]:
    require(RESUME_CSV)
    total = kept = short = 0
    by_family: Counter[str] = Counter()
    rows: list[dict[str, str]] = []
    with RESUME_CSV.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for r in reader:
            total += 1
            category = clean_cell(r.get("Category", ""), max_chars=120)
            if category not in SCOPED_FAMILIES:
                continue
            raw_text = str(r.get("Resume_str") or "").strip()
            if len(raw_text) < MIN_RESUME_CHARS:
                short += 1
                continue
            row = {
                "id": clean_cell(r.get("ID", ""), max_chars=120) or f"resume-{total}",
                "category": category,
                "raw_text": raw_text,
            }
            rows.append(row)
            kept += 1
            by_family[category] += 1

    write_jsonl(path, rows)
    return {
        "source": str(RESUME_CSV.relative_to(REPO)),
        "total_rows": total,
        "kept_rows": kept,
        "short_or_empty_rows": short,
        "families": dict(by_family),
        "out": str(path.relative_to(REPO)),
    }


def posting_text(row: dict[str, str]) -> str:
    title = clean_cell(row.get("title", ""), max_chars=300)
    company = clean_cell(row.get("company_name", ""), max_chars=200)
    description = str(row.get("description") or "").strip()
    return "\n".join([f"Title: {title}", f"Company: {company}", "", description]).strip()


def jd_artifact(row: dict[str, str], family: str, confidence: float, rationale: str) -> dict[str, Any]:
    return {
        "job_id": clean_cell(row.get("job_id", ""), max_chars=120),
        "family": family,
        "title": clean_cell(row.get("title", ""), max_chars=300),
        "company_name": clean_cell(row.get("company_name", ""), max_chars=200),
        "description": str(row.get("description") or "").strip(),
        "skills_desc": clean_cell(row.get("skills_desc", ""), max_chars=1200),
        "posting_text": posting_text(row),
        "llm_confidence": confidence,
        "llm_rationale": rationale,
    }


def iter_unique_postings(keyword_scoped_only: bool) -> Iterable[dict[str, str]]:
    require(POSTINGS_CSV)
    seen: set[tuple[str, str, str]] = set()
    with POSTINGS_CSV.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            title = clean_cell(row.get("title", ""), max_chars=300)
            company = clean_cell(row.get("company_name", ""), max_chars=200)
            description = str(row.get("description") or "").strip()
            if not title or len(description) < MIN_DESCRIPTION_CHARS:
                continue
            key = (title.lower(), company.lower(), description[:2000].lower())
            if key in seen:
                continue
            seen.add(key)
            if keyword_scoped_only and map_title(title) not in SCOPED_FAMILIES:
                continue
            yield {
                "job_id": clean_cell(row.get("job_id", ""), max_chars=120),
                "company_name": company,
                "title": title,
                "description": description,
                "skills_desc": clean_cell(row.get("skills_desc", ""), max_chars=3000),
            }


def usable_cached_label(cached: dict[str, Any] | None) -> tuple[str, float, str] | None:
    if not cached or cached.get("error"):
        return None
    family = str(cached.get("family") or "")
    try:
        confidence = float(cached.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    rationale = str(cached.get("rationale") or "")
    return family, confidence, rationale


def prepare_jds(args: argparse.Namespace, path: Path = JDS_OUT) -> dict[str, Any]:
    require(POSTINGS_CSV)
    load_dotenv()
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    model = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    cache_path = Path(args.cache)
    cache = read_jsonl_cache(cache_path)

    selected: dict[str, list[dict[str, Any]]] = {family: [] for family in SCOPED_FAMILIES}
    selected_keys: set[str] = set()
    stats = {
        "cache_path": str(cache_path.relative_to(REPO) if cache_path.is_relative_to(REPO) else cache_path),
        "model": model,
        "target_per_family": args.jd_per_family,
        "min_confidence": args.min_confidence,
        "cache_hits": 0,
        "api_calls": 0,
        "api_errors": 0,
        "candidate_rows_seen": 0,
        "passes": [],
    }

    def done() -> bool:
        return all(len(selected[f]) >= args.jd_per_family for f in SCOPED_FAMILIES)

    def maybe_select(row: dict[str, str], family: str, confidence: float, rationale: str) -> None:
        if family not in SCOPED_FAMILIES:
            return
        if confidence < args.min_confidence:
            return
        if len(selected[family]) >= args.jd_per_family:
            return
        key = posting_cache_key(row)
        if key in selected_keys:
            return
        selected[family].append(jd_artifact(row, family, confidence, rationale))
        selected_keys.add(key)
        title = row["title"][:70].encode("ascii", errors="replace").decode("ascii")
        print(f"  selected {family}: {len(selected[family])}/{args.jd_per_family} - {title}")

    if not api_key and not all(len(v) >= args.jd_per_family for v in selected.values()):
        print("No OPENAI_API_KEY loaded; cached labels will be used if already available.")

    for pass_name, keyword_only in (("keyword_scoped_candidates", True), ("fallback_all_postings", False)):
        pass_seen = 0
        for row in iter_unique_postings(keyword_scoped_only=keyword_only):
            if done():
                break
            if keyword_only and map_title(row["title"]) in selected and len(selected[map_title(row["title"])]) >= args.jd_per_family:
                continue

            pass_seen += 1
            stats["candidate_rows_seen"] += 1
            key = posting_cache_key(row)
            cached = usable_cached_label(cache.get(key))
            if cached:
                stats["cache_hits"] += 1
                family, confidence, rationale = cached
                maybe_select(row, family, confidence, rationale)
                continue

            if stats["api_calls"] >= args.max_llm_calls:
                break
            if not api_key:
                continue

            try:
                mapped = classify_posting(row, api_key=api_key, model=model)
            except Exception as exc:
                stats["api_errors"] += 1
                mapped = {
                    "cache_key": key,
                    "job_id": row.get("job_id", ""),
                    "title": row.get("title", ""),
                    "company_name": row.get("company_name", ""),
                    "family": "",
                    "confidence": "",
                    "rationale": "",
                    "error": str(exc)[:1000],
                    "model": model,
                }
            cache[key] = mapped
            append_jsonl(cache_path, mapped)
            stats["api_calls"] += 1

            label = usable_cached_label(mapped)
            if label:
                family, confidence, rationale = label
                maybe_select(row, family, confidence, rationale)

            if args.delay > 0:
                time.sleep(args.delay)

        stats["passes"].append({"name": pass_name, "rows_seen": pass_seen})
        if done():
            break

    missing = {f: args.jd_per_family - len(selected[f]) for f in SCOPED_FAMILIES if len(selected[f]) < args.jd_per_family}
    rows = [row for family in SCOPED_FAMILIES for row in selected[family]]
    write_jsonl(path, rows)
    stats["selected"] = {family: len(selected[family]) for family in SCOPED_FAMILIES}
    stats["out"] = str(path.relative_to(REPO))
    if missing:
        stats["missing"] = missing
        print(f"Warning: did not collect requested JD counts: {missing}")
    return stats


def prepare_smoke() -> None:
    context = REPO / "context"
    samples = [
        ("information_technology_36856210", "INFORMATION-TECHNOLOGY", context / "resume_samples" / "information_technology_36856210.txt"),
        ("finance_11877150", "FINANCE", context / "resume_samples" / "finance_11877150.txt"),
        ("consultant_27096471", "CONSULTANT", context / "resume_samples" / "consultant_27096471.txt"),
    ]
    resume_rows = [
        {"id": rid, "category": family, "raw_text": path.read_text(encoding="utf-8")}
        for rid, family, path in samples
    ]
    jd_rows = [
        {
            "job_id": "smoke-it",
            "family": "INFORMATION-TECHNOLOGY",
            "title": "Software Engineer",
            "company_name": "Smoke Fixture",
            "description": "Build software services with Python, SQL, cloud infrastructure, APIs, and debugging.",
            "skills_desc": "Python, SQL, cloud, software engineering",
            "posting_text": "Title: Software Engineer\nCompany: Smoke Fixture\n\nRequired: Python and SQL experience. Experience building cloud software services is required.",
            "llm_confidence": 1.0,
            "llm_rationale": "Smoke fixture.",
        },
        {
            "job_id": "smoke-finance",
            "family": "FINANCE",
            "title": "Financial Analyst",
            "company_name": "Smoke Fixture",
            "description": "Analyze forecasts, financial models, budgets, and management reporting.",
            "skills_desc": "Financial modeling, forecasting, Excel",
            "posting_text": "Title: Financial Analyst\nCompany: Smoke Fixture\n\nRequired: financial modeling, forecasting, Excel analysis, and stakeholder communication.",
            "llm_confidence": 1.0,
            "llm_rationale": "Smoke fixture.",
        },
        {
            "job_id": "smoke-consultant",
            "family": "CONSULTANT",
            "title": "Management Consultant",
            "company_name": "Smoke Fixture",
            "description": "Advise clients on process improvement, analysis, project management, and presentations.",
            "skills_desc": "Consulting, process improvement, project management",
            "posting_text": "Title: Management Consultant\nCompany: Smoke Fixture\n\nRequired: consulting experience, process improvement, project management, and client-ready communication.",
            "llm_confidence": 1.0,
            "llm_rationale": "Smoke fixture.",
        },
    ]
    write_jsonl(SMOKE_RESUMES_OUT, resume_rows)
    write_jsonl(SMOKE_JDS_OUT, jd_rows)
    report = {
        "mode": "smoke",
        "resumes": {"kept_rows": len(resume_rows), "families": dict(Counter(r["category"] for r in resume_rows)), "out": str(SMOKE_RESUMES_OUT.relative_to(REPO))},
        "jds": {"selected": dict(Counter(r["family"] for r in jd_rows)), "out": str(SMOKE_JDS_OUT.relative_to(REPO))},
    }
    SMOKE_REPORT_OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote smoke artifacts:\n  {SMOKE_RESUMES_OUT}\n  {SMOKE_JDS_OUT}\n  {SMOKE_REPORT_OUT}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--smoke", action="store_true", help="Write tiny local fixtures; no OpenAI calls.")
    p.add_argument("--jd-per-family", type=int, default=100, help="High-confidence JDs to collect per scoped family.")
    p.add_argument("--min-confidence", type=float, default=0.75, help="Minimum LLM confidence for selected JDs.")
    p.add_argument("--max-llm-calls", type=int, default=1500, help="Safety cap for uncached OpenAI calls.")
    p.add_argument("--delay", type=float, default=0.0, help="Seconds to sleep between OpenAI calls.")
    p.add_argument("--cache", default=str(CACHE_OUT), help="JSONL cache for posting family labels.")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    if args.smoke:
        prepare_smoke()
        return

    ART.mkdir(parents=True, exist_ok=True)
    print("Preparing scoped validation data...")
    resumes = prepare_resumes()
    jds = prepare_jds(args)
    report = {"mode": "scoped-real-jd", "scoped_families": SCOPED_FAMILIES, "resumes": resumes, "jds": jds}
    REPORT_OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote:\n  {RESUMES_OUT}\n  {JDS_OUT}\n  {REPORT_OUT}")
    if "missing" in jds:
        sys.exit(2)


if __name__ == "__main__":
    main()
