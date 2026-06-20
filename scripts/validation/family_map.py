#!/usr/bin/env python3
"""
Curated job-title -> resume-family mapping — OFFLINE PLANE (validation only).

The resume corpus (Kaggle, snehaanbhawal) labels every resume with one of 24
``Category`` families. The fit-scorer validation tests the falsifiable claim that
a resume scores highest against postings *from its own field*, so we need to map
each free-text LinkedIn posting ``title`` to one of those families.

This map is **hand-curated and auditable on purpose** (matching the proposal's
"every point traces back" theme): a posting is assigned to the FIRST family whose
keyword matches, so the ordering below resolves overlaps deliberately
(e.g. "software engineer" -> INFORMATION-TECHNOLOGY before generic "engineer"
-> ENGINEERING; "business development" before "sales").

Mapping noise is the single biggest threat to the headline accuracy number, so
``prepare_data.py`` reports coverage (% of postings mapped) and the per-family
posting counts alongside the result. Tune the keywords here, never downstream.

The three smallest resume families are dropped per the EDA ("drop the three
under-populated resume categories"): BPO (22), AUTOMOBILE (36), AGRICULTURE (63).
"""

from __future__ import annotations

import re

# Families retained for the study (24 corpus families minus the 3 smallest).
DROPPED_FAMILIES = ["BPO", "AUTOMOBILE", "AGRICULTURE"]

# Ordered (family, keywords) — FIRST match wins, so order resolves overlaps.
# Keywords are matched on word boundaries, case-insensitively; multi-word
# keywords are allowed.
FAMILY_KEYWORDS: list[tuple[str, list[str]]] = [
    ("ACCOUNTANT", ["accountant", "accounting", "cpa", "bookkeeper", "bookkeeping",
                    "accounts payable", "accounts receivable", "controller", "auditor"]),
    ("ADVOCATE", ["attorney", "lawyer", "advocate", "paralegal", "litigation",
                  "legal counsel", "counsel", "legal assistant", "law clerk"]),
    ("AVIATION", ["pilot", "aviation", "aircraft", "flight attendant", "aerospace",
                  "airline", "avionics", "air traffic"]),
    ("BANKING", ["teller", "loan officer", "mortgage", "credit analyst", "branch manager",
                 "personal banker", "underwriter", "bank"]),
    ("CHEF", ["chef", "sous chef", "line cook", "cook", "culinary", "kitchen",
              "pastry", "baker"]),
    ("CONSTRUCTION", ["construction", "civil engineer", "foreman", "estimator",
                      "site supervisor", "general contractor", "contractor",
                      "surveyor", "carpenter"]),
    ("CONSULTANT", ["consultant", "consulting", "advisory", "management consultant"]),
    ("PUBLIC-RELATIONS", ["public relations", "pr manager", "media relations",
                          "press secretary", "communications specialist",
                          "communications manager", "publicist"]),
    ("DIGITAL-MEDIA", ["digital media", "social media", "seo", "sem",
                       "content creator", "digital marketing", "community manager",
                       "content strategist", "copywriter"]),
    ("HR", ["human resources", "recruiter", "talent acquisition", "hr manager",
            "hr generalist", "people operations", "hris", "benefits coordinator",
            "hr business partner"]),
    ("FINANCE", ["financial analyst", "fp&a", "treasury", "investment analyst",
                 "financial planning", "finance manager", "financial advisor",
                 "portfolio", "equity research", "finance"]),
    ("BUSINESS-DEVELOPMENT", ["business development", "partnerships", "bd manager",
                              "business developer"]),
    ("SALES", ["sales", "account executive", "account manager", "sales representative",
               "sales associate", "retail sales", "sales manager", "inside sales"]),
    ("HEALTHCARE", ["nurse", "registered nurse", "healthcare", "medical assistant",
                    "physician", "clinical", "patient care", "therapist", "pharmacist",
                    "caregiver", "medical", "health"]),
    ("FITNESS", ["fitness", "personal trainer", "gym", "yoga instructor",
                 "wellness coach", "group fitness", "athletic trainer"]),
    ("TEACHER", ["teacher", "professor", "instructor", "tutor", "lecturer",
                 "educator", "teaching assistant", "faculty", "substitute teacher"]),
    ("DESIGNER", ["ux designer", "ui designer", "graphic designer", "product designer",
                  "web designer", "design lead", "interaction designer", "designer"]),
    ("ARTS", ["artist", "painter", "musician", "photographer", "art director",
              "illustrator", "fine arts", "animator", "sculptor"]),
    ("APPAREL", ["apparel", "fashion", "merchandiser", "garment", "textile",
                 "stylist", "tailor", "fashion designer"]),
    ("INFORMATION-TECHNOLOGY", ["software", "developer", "programmer", ".net", "java",
                                "python", "data engineer", "data scientist",
                                "network administrator", "system administrator",
                                "systems administrator", "devops", "qa engineer",
                                "information technology", "it support", "web developer",
                                "full stack", "full-stack", "back end", "backend",
                                "front end", "frontend", "database administrator",
                                "cybersecurity", "cloud engineer", "sql", "machine learning"]),
    ("ENGINEERING", ["engineer", "engineering", "mechanical", "electrical",
                     "manufacturing engineer", "process engineer", "quality engineer",
                     "industrial engineer", "chemical engineer"]),
]

# Precompiled word-boundary matchers, preserving order.
_PATTERNS: list[tuple[str, list[re.Pattern]]] = [
    (fam, [re.compile(r"(?<![a-z0-9])" + re.escape(k) + r"(?![a-z0-9])", re.I) for k in kws])
    for fam, kws in FAMILY_KEYWORDS
]

RETAINED_FAMILIES = [fam for fam, _ in FAMILY_KEYWORDS]


def map_title(title: str) -> str | None:
    """Map a posting title to a retained resume family, or None if no keyword hits."""
    if not title:
        return None
    for fam, pats in _PATTERNS:
        if any(p.search(title) for p in pats):
            return fam
    return None
