#!/usr/bin/env python3
"""
O*NET taxonomy extractor — OFFLINE PLANE (per CLAUDE.md two-plane rule).

Reads the local-only, gitignored O*NET 30.3 text database from
``Datasets/db_30_3_text/`` and emits the compact, committed taxonomy that ships
with the app: ``lib/data/onet-taxonomy.json``.

The live plane NEVER reads ``Datasets/`` — only the committed JSON. Re-run this
script (locally, with the dataset present) to regenerate the taxonomy:

    python3 scripts/onet/extract_taxonomy.py

Extraction decisions (kept small and curated, analytics/consulting/tech only):
  * occupations  : a hand-picked set of ~21 SOC codes (TARGET_SOCS).
  * core_skills  : Essential + Transferable skills, Importance (IM) >= 3.0, top 12.
  * core_knowledge: Knowledge areas, Importance (IM) >= 3.25, top 8.
  * tools        : O*NET "hot"/"in demand" software, canonicalised through the
                   curated SKILL_VOCAB (drops names outside our vocab so the file
                   stays small and the vocabulary stays consistent), cap 22.
  * core_tasks   : Task Statements (prefer Task Type == "Core"; fall back to any
                   type for newer occupations that have no Core flag), top 7.
  * aliases      : Sample of Reported Titles (real-world titles), cap 10.

The SKILL_VOCAB (canonical -> aliases + related) is the load-bearing
normalisation layer used by lib/onet.ts at runtime. O*NET's own skill names are
abstract ("Programming", "Critical Thinking") and don't cover concrete surface
forms ("SQL" vs "Structured Query Language" vs "sql"), so this map is curated by
hand and cross-checked against the actual O*NET hot-technology tool names.
"""

from __future__ import annotations

import json
import os
import re
from datetime import date

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA_DIR = os.path.join(REPO, "Datasets", "db_30_3_text")
OUT_PATH = os.path.join(REPO, "lib", "data", "onet-taxonomy.json")

ONET_VERSION = "O*NET 30.3"

# --------------------------------------------------------------------------- #
# Curated occupation set — analytics / consulting / tech
# --------------------------------------------------------------------------- #
TARGET_SOCS = [
    "13-1111.00",  # Management Analysts  (consulting)
    "13-1161.00",  # Market Research Analysts and Marketing Specialists
    "13-1081.00",  # Logisticians
    "13-1082.00",  # Project Management Specialists
    "13-2051.00",  # Financial and Investment Analysts
    "11-2021.00",  # Marketing Managers
    "11-3021.00",  # Computer and Information Systems Managers
    "15-1211.00",  # Computer Systems Analysts
    "15-1212.00",  # Information Security Analysts
    "15-1242.00",  # Database Administrators
    "15-1243.00",  # Database Architects
    "15-1244.00",  # Network and Computer Systems Administrators
    "15-1251.00",  # Computer Programmers
    "15-1252.00",  # Software Developers
    "15-1254.00",  # Web Developers
    "15-1299.05",  # Information Security Engineers
    "15-2011.00",  # Actuaries
    "15-2031.00",  # Operations Research Analysts
    "15-2041.00",  # Statisticians
    "15-2051.00",  # Data Scientists
    "15-2051.01",  # Business Intelligence Analysts
]

# --------------------------------------------------------------------------- #
# Curated skill / tool / domain vocabulary.
#   canonical -> (category, [aliases], [related canonicals])
# Aliases are matched case-insensitively on word boundaries (so "R" and "C"
# never fire inside "Redshift" / "C#"). "related" powers partial-credit matching
# (e.g. a "data visualization" requirement is partly met by "Tableau").
# --------------------------------------------------------------------------- #
SKILL_VOCAB: dict[str, tuple[str, list[str], list[str]]] = {
    # ---- Languages / core tools ----------------------------------------- #
    "SQL": ("tool", ["sql", "structured query language", "t-sql", "tsql",
                      "pl/sql", "mysql", "postgresql", "postgres",
                      "microsoft sql server", "sql server", "oracle database"],
            []),
    "Python": ("tool", ["python", "py"], []),
    "R": ("tool", ["r"], []),
    "Java": ("tool", ["java", "oracle java"], []),
    "JavaScript": ("tool", ["javascript", "js"], []),
    "TypeScript": ("tool", ["typescript", "ts"], []),
    "C++": ("tool", ["c++", "cpp"], []),
    "C#": ("tool", ["c#", "c sharp"], []),
    "Scala": ("tool", ["scala"], []),
    "Go": ("tool", ["golang", "go programming"], []),
    "MATLAB": ("tool", ["matlab"], []),
    "SAS": ("tool", ["sas"], ["Statistics"]),
    "SPSS": ("tool", ["spss", "ibm spss"], ["Statistics"]),
    "Stata": ("tool", ["stata"], ["Statistics"]),
    "VBA": ("tool", ["vba", "visual basic for applications"], ["Excel"]),
    "Bash": ("tool", ["bash", "shell scripting"], ["Linux"]),
    # ---- BI / spreadsheets ---------------------------------------------- #
    "Excel": ("tool", ["excel", "microsoft excel"], []),
    "Power BI": ("tool", ["power bi", "powerbi", "microsoft power bi"],
                 ["Data Visualization"]),
    "Tableau": ("tool", ["tableau"], ["Data Visualization"]),
    "Looker": ("tool", ["looker", "google looker"], ["Data Visualization"]),
    "QlikView": ("tool", ["qlik", "qlikview"], ["Data Visualization"]),
    # ---- Data engineering / big data ------------------------------------ #
    "Spark": ("tool", ["spark", "apache spark", "pyspark"], ["ETL"]),
    "Hadoop": ("tool", ["hadoop", "apache hadoop"], ["ETL"]),
    "Hive": ("tool", ["hive", "apache hive"], ["ETL"]),
    "Kafka": ("tool", ["kafka", "apache kafka"], ["ETL"]),
    "Airflow": ("tool", ["airflow", "apache airflow"], ["ETL"]),
    "Snowflake": ("tool", ["snowflake"], ["Data Warehousing"]),
    "Redshift": ("tool", ["redshift", "amazon redshift"], ["Data Warehousing"]),
    "BigQuery": ("tool", ["bigquery", "big query"], ["Data Warehousing"]),
    "Databricks": ("tool", ["databricks"], []),
    "NoSQL": ("tool", ["nosql"], []),
    "MongoDB": ("tool", ["mongodb", "mongo"], ["NoSQL"]),
    # ---- Cloud / devops ------------------------------------------------- #
    "AWS": ("tool", ["aws", "amazon web services"], ["Cloud Computing"]),
    "Azure": ("tool", ["azure", "microsoft azure"], ["Cloud Computing"]),
    "GCP": ("tool", ["gcp", "google cloud"], ["Cloud Computing"]),
    "Docker": ("tool", ["docker"], ["DevOps"]),
    "Kubernetes": ("tool", ["kubernetes", "k8s"], ["DevOps"]),
    "Git": ("tool", ["git", "github", "gitlab"], []),
    "Linux": ("tool", ["linux", "unix"], []),
    "Jira": ("tool", ["jira", "atlassian jira"], ["Agile"]),
    # ---- ML frameworks -------------------------------------------------- #
    "TensorFlow": ("tool", ["tensorflow"], ["Machine Learning"]),
    "PyTorch": ("tool", ["pytorch"], ["Machine Learning"]),
    "Scikit-learn": ("tool", ["scikit-learn", "sklearn", "scikit learn"],
                     ["Machine Learning"]),
    "Pandas": ("tool", ["pandas"], ["Python"]),
    "NumPy": ("tool", ["numpy"], ["Python"]),
    # ---- Techniques / competencies -------------------------------------- #
    "Machine Learning": ("skill", ["machine learning", "ml", "predictive modeling",
                                   "predictive modelling"],
                         ["TensorFlow", "PyTorch", "Scikit-learn", "Deep Learning"]),
    "Deep Learning": ("skill", ["deep learning", "neural networks"],
                      ["TensorFlow", "PyTorch"]),
    "NLP": ("skill", ["nlp", "natural language processing"], ["Machine Learning"]),
    "Data Visualization": ("skill", ["data visualization", "data visualisation",
                                     "data viz", "dataviz", "dashboards",
                                     "dashboarding", "reporting"],
                           ["Tableau", "Power BI", "Looker"]),
    "Data Modeling": ("skill", ["data modeling", "data modelling",
                                "dimensional modeling", "schema design"], []),
    "Data Analysis": ("skill", ["data analysis", "data analytics",
                                "analytics", "quantitative analysis"], []),
    "Statistics": ("skill", ["statistics", "statistical analysis",
                             "statistical modeling", "biostatistics"],
                   ["Regression", "A/B Testing", "R", "SAS"]),
    "Regression": ("skill", ["regression"], ["Statistics"]),
    "A/B Testing": ("skill", ["a/b testing", "ab testing", "split testing"],
                    ["Experimentation"]),
    "Experimentation": ("skill", ["experimentation", "experimental design"],
                        ["A/B Testing"]),
    "ETL": ("skill", ["etl", "elt", "data pipelines", "data pipeline"],
            ["Spark", "Airflow"]),
    "Data Warehousing": ("skill", ["data warehouse", "data warehousing"],
                         ["Snowflake", "Redshift", "BigQuery"]),
    "Data Engineering": ("skill", ["data engineering"], ["ETL", "Spark"]),
    "Forecasting": ("skill", ["forecasting", "demand planning",
                              "time series", "time-series"], ["Statistics"]),
    "Optimization": ("skill", ["optimization", "optimisation",
                               "linear programming", "operations research"], []),
    "Financial Modeling": ("skill", ["financial modeling", "financial modelling",
                                     "valuation", "dcf"], ["Excel"]),
    "Business Intelligence": ("skill", ["business intelligence"],
                              ["Tableau", "Power BI", "SQL"]),
    "Segmentation": ("skill", ["segmentation", "clustering"], []),
    "Cloud Computing": ("skill", ["cloud computing", "cloud"],
                        ["AWS", "Azure", "GCP"]),
    "DevOps": ("skill", ["devops", "ci/cd", "continuous integration"],
               ["Docker", "Kubernetes"]),
    "Cybersecurity": ("skill", ["cybersecurity", "cyber security",
                                "information security", "infosec",
                                "network security", "application security"],
                      ["Risk Management"]),
    "Risk Management": ("skill", ["risk management", "risk assessment"], []),
    "Project Management": ("skill", ["project management", "program management",
                                     "pmp"], ["Agile"]),
    "Agile": ("skill", ["agile", "scrum", "kanban"], ["Jira"]),
    "Product Management": ("skill", ["product management", "roadmap"], []),
    "Stakeholder Management": ("skill", ["stakeholder management",
                                         "stakeholder engagement"],
                               ["Communication"]),
    "Communication": ("skill", ["communication", "presentation",
                                "written communication", "verbal communication"],
                      []),
    "Problem Solving": ("skill", ["problem solving", "problem-solving",
                                  "critical thinking", "analytical thinking"], []),
    "Leadership": ("skill", ["leadership", "team leadership", "people management"],
                   []),
    "Process Improvement": ("skill", ["process improvement", "lean",
                                      "six sigma", "process optimization"], []),
    "Requirements Gathering": ("skill", ["requirements gathering",
                                         "requirements analysis",
                                         "business requirements"], []),
    # ---- Domains -------------------------------------------------------- #
    "Finance": ("domain", ["finance", "financial services", "banking",
                           "investment", "fintech"], []),
    "Healthcare": ("domain", ["healthcare", "health care", "clinical",
                              "pharmaceutical", "biotech"], []),
    "Retail": ("domain", ["retail", "e-commerce", "ecommerce", "consumer goods",
                          "cpg"], []),
    "Insurance": ("domain", ["insurance", "actuarial"], []),
    "Marketing": ("domain", ["marketing", "advertising", "growth", "crm"], []),
    "Manufacturing": ("domain", ["manufacturing", "supply chain", "logistics"],
                      []),
    "Telecommunications": ("domain", ["telecommunications", "telecom"], []),
    "Consulting": ("domain", ["consulting", "advisory", "management consulting"],
                   []),
}

# Precompile alias -> canonical word-boundary matchers for tool canonicalisation.
_ALIAS_PATTERNS: list[tuple[re.Pattern, str]] = []
for _canon, (_cat, _aliases, _rel) in SKILL_VOCAB.items():
    for _a in _aliases:
        _ALIAS_PATTERNS.append(
            (re.compile(r"(?<![a-z0-9])" + re.escape(_a) + r"(?![a-z0-9])", re.I), _canon)
        )


# --------------------------------------------------------------------------- #
# File reading helpers
# --------------------------------------------------------------------------- #
def read_rows(filename: str) -> list[list[str]]:
    """Read a tab-delimited O*NET file, skipping the header row."""
    path = os.path.join(DATA_DIR, filename)
    rows: list[list[str]] = []
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        for i, line in enumerate(fh):
            if i == 0:
                continue
            rows.append(line.rstrip("\n").rstrip("\r").split("\t"))
    return rows


def canon_tool(raw_name: str) -> str | None:
    """Map an O*NET software/tool name to a curated canonical, or None."""
    for pat, canon in _ALIAS_PATTERNS:
        if pat.search(raw_name):
            return canon
    return None


# --------------------------------------------------------------------------- #
# Per-element extraction
# --------------------------------------------------------------------------- #
def importance_top(rows: list[list[str]], soc: str, threshold: float, cap: int) -> list[tuple[str, float]]:
    """Return [(element_name, importance)] for one SOC, IM-filtered & sorted."""
    out: dict[str, float] = {}
    for r in rows:
        if len(r) < 5 or r[0] != soc or r[3] != "IM":
            continue
        try:
            val = float(r[4])
        except ValueError:
            continue
        if val < threshold:
            continue
        name = r[2]
        if name not in out or val > out[name]:
            out[name] = val
    ranked = sorted(out.items(), key=lambda kv: (-kv[1], kv[0]))
    return ranked[:cap]


def main() -> None:
    if not os.path.isdir(DATA_DIR):
        raise SystemExit(
            f"O*NET data not found at {DATA_DIR}\n"
            "This extractor is offline-plane and needs the local (gitignored) dataset."
        )

    occ_rows = read_rows("Occupation Data.txt")
    ess_rows = read_rows("Essential Skills.txt")
    trf_rows = read_rows("Transferable Skills.txt")
    kno_rows = read_rows("Knowledge.txt")
    soft_rows = read_rows("Software Skills.txt")
    task_rows = read_rows("Task Statements.txt")
    title_rows = read_rows("Sample of Reported Titles.txt")

    occ_by_soc = {r[0]: r for r in occ_rows if len(r) >= 3}

    occupations = []
    for soc in TARGET_SOCS:
        meta = occ_by_soc.get(soc)
        if not meta:
            print(f"  ! SOC {soc} missing from Occupation Data — skipped")
            continue
        title = meta[1]
        description = meta[2][:300]

        # core_skills: Essential + Transferable combined, IM >= 3.0, top 12.
        skills_ranked = importance_top(ess_rows, soc, 3.0, 50) + importance_top(trf_rows, soc, 3.0, 50)
        merged: dict[str, float] = {}
        for name, val in skills_ranked:
            if name not in merged or val > merged[name]:
                merged[name] = val
        core_skills = [n for n, _ in sorted(merged.items(), key=lambda kv: (-kv[1], kv[0]))][:12]

        # core_knowledge: IM >= 3.25, top 8.
        core_knowledge = [n for n, _ in importance_top(kno_rows, soc, 3.25, 8)]

        # tools: hot/in-demand software, canonicalised to category=="tool" only
        # (so skills/domains don't leak in), ranked by O*NET signal
        # (in-demand > hot, both > either), deduped, cap 22.
        tool_cands: list[tuple[int, int, str]] = []
        for idx, r in enumerate(soft_rows):
            if len(r) < 6 or r[0] != soc:
                continue
            hot, demand = r[4], r[5]
            if hot != "Y" and demand != "Y":
                continue
            canon = canon_tool(r[1])
            if not canon or SKILL_VOCAB[canon][0] != "tool":
                continue
            priority = (2 if demand == "Y" else 0) + (1 if hot == "Y" else 0)
            tool_cands.append((priority, idx, canon))
        tool_cands.sort(key=lambda c: (-c[0], c[1]))
        tools: list[str] = []
        seen_tools: set[str] = set()
        for _p, _i, canon in tool_cands:
            if canon not in seen_tools:
                seen_tools.add(canon)
                tools.append(canon)
        tools = tools[:22]

        # core_tasks: prefer Type == "Core"; fall back to any type, top 7.
        core_tasks = [r[2] for r in task_rows if len(r) >= 4 and r[0] == soc and r[3] == "Core"]
        if not core_tasks:
            core_tasks = [r[2] for r in task_rows if len(r) >= 3 and r[0] == soc]
        core_tasks = core_tasks[:7]

        # aliases: real-world reported titles, cap 10 (deduped, title excluded).
        aliases: list[str] = []
        seen_titles = {title.lower()}
        for r in title_rows:
            if len(r) >= 2 and r[0] == soc:
                t = r[1].strip()
                if t and t.lower() not in seen_titles:
                    seen_titles.add(t.lower())
                    aliases.append(t)
        aliases = aliases[:10]

        occupations.append({
            "soc": soc,
            "title": title,
            "description": description,
            "aliases": aliases,
            "core_skills": core_skills,
            "core_knowledge": core_knowledge,
            "tools": tools,
            "core_tasks": core_tasks,
        })
        print(f"  {soc}  {title:<48} skills={len(core_skills):>2} "
              f"know={len(core_knowledge):>2} tools={len(tools):>2} tasks={len(core_tasks)}")

    # skills map: canonical -> {category, aliases, related}
    skills = {
        canon: {"category": cat, "aliases": aliases, "related": related}
        for canon, (cat, aliases, related) in SKILL_VOCAB.items()
    }

    out = {
        "version": ONET_VERSION,
        "generated_at": date.today().isoformat(),
        "note": "Curated analytics/consulting/tech subset of O*NET. Live plane reads "
                "only this file; never Datasets/. Regenerate via scripts/onet/extract_taxonomy.py.",
        "occupations": occupations,
        "skills": skills,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"\nWrote {OUT_PATH}")
    print(f"  occupations={len(occupations)}  canonical_skills={len(skills)}  size={size_kb:.1f} KB")


if __name__ == "__main__":
    main()
