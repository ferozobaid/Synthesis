#!/usr/bin/env python3
"""
Build the current Synthesis Fit Validation Study PDF.

Run:
  python reports/build_reports.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
ART = os.path.join(REPO, "scripts", "validation", ".artifacts")
SNAPSHOT_DIR = os.path.join(HERE, "fit-validation")

NAVY = colors.HexColor("#1f3a5f")
GREY = colors.HexColor("#64748b")
LIGHT = colors.HexColor("#f1f5f9")

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Title"], textColor=NAVY, fontSize=22, spaceAfter=4, alignment=TA_LEFT)
SUB = ParagraphStyle("SUB", parent=styles["Normal"], textColor=GREY, fontSize=9.5, spaceAfter=10)
PART = ParagraphStyle("PART", parent=styles["Heading1"], textColor=NAVY, fontSize=17, leading=21, spaceAfter=2)
PARTSUB = ParagraphStyle("PARTSUB", parent=SUB, fontSize=10, leading=13, spaceAfter=10)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], textColor=NAVY, fontSize=13.5, spaceBefore=12, spaceAfter=4)
BODY = ParagraphStyle("BODY", parent=styles["Normal"], fontSize=9.7, leading=13.5, spaceAfter=6)
SMALL = ParagraphStyle("SMALL", parent=styles["Normal"], fontSize=8.3, leading=11, textColor=GREY)
CELL = ParagraphStyle("CELL", parent=styles["Normal"], fontSize=8.6, leading=11)
CELLB = ParagraphStyle("CELLB", parent=CELL, fontName="Helvetica-Bold")


def P(text, style=BODY):
    return Paragraph(text, style)


def table(data, col_widths, header=True, font=8.6):
    t = Table(data, colWidths=col_widths, repeatRows=1 if header else 0)
    style = [
        ("FONTSIZE", (0, 0), (-1, -1), font),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor("#e2e8f0")),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ]
    t.setStyle(TableStyle(style))
    return t


def dash_items(items, style=BODY):
    return [P("- " + item, style) for item in items]


def footer_for(report_date):
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(GREY)
        canvas.drawString(
            0.7 * inch,
            0.5 * inch,
            f"Synthesis Fit Validation Study - {report_date}",
        )
        canvas.drawRightString(
            letter[0] - 0.7 * inch,
            0.5 * inch,
            f"Page {doc.page}",
        )
        canvas.restoreState()

    return footer


def pct(x):
    return f"{100 * float(x):.1f}%"


def fmt(x, digits=3):
    return f"{float(x):.{digits}f}"


def pair_arm_name(key):
    return {
        "structured": "Rules-only structured",
        "embedding": "Embedding-only semantic",
        "hybrid_0_25": "Hybrid 0.25 rules / 0.75 semantic",
        "hybrid_0_5": "Hybrid 0.50 rules / 0.50 semantic",
        "hybrid_0_75": "Hybrid 0.75 rules / 0.25 semantic",
    }.get(key, key)


def code_arm_name(key):
    if key.startswith("hybrid_"):
        return f"Family-normalized {pair_arm_name(key).lower()}"
    return pair_arm_name(key)


def display_family(label):
    return {
        "CONSULTANT": "Consultant",
        "FINANCE": "Finance",
        "INFORMATION-TECHNOLOGY": "IT",
    }.get(label, label)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(value, fh, ensure_ascii=True, indent=2)
        fh.write("\n")


def study_paths():
    local = {
        "code_metrics": os.path.join(ART, "metrics.scoped.json"),
        "human_metrics": os.path.join(ART, "human54", "metrics.json"),
        "human_manifest": os.path.join(ART, "human54", "manifest.json"),
    }
    snapshots = {
        "code_metrics": os.path.join(
            SNAPSHOT_DIR,
            "code-validation-summary.json",
        ),
        "human_metrics": os.path.join(
            SNAPSHOT_DIR,
            "human-validation-summary.json",
        ),
        "human_manifest": os.path.join(
            SNAPSHOT_DIR,
            "human-validation-manifest.json",
        ),
    }
    if all(os.path.exists(path) for path in local.values()):
        return local, True
    if all(os.path.exists(path) for path in snapshots.values()):
        return snapshots, False
    sys.exit(
        "Missing Fit validation evidence. Run the scoped code validation and "
        "completed 54-pair workflow, or restore reports/fit-validation snapshots."
    )


def verify_code_evidence(metrics):
    manifest = metrics.get("validation_manifest") or {}
    if manifest.get("mode") != "scoped-real-jd":
        sys.exit("Code-validation evidence must come from a full scoped run.")
    if manifest.get("diagnostic_parameters") is not None:
        sys.exit("Diagnostic code-validation evidence cannot be published.")
    embedding = manifest.get("embedding") or {}
    if embedding.get("backend") != "bge":
        sys.exit(
            "The scoped code-validation evidence does not record backend=bge. "
            "Run npm run validate:fit and npm run validate:report."
        )
    if embedding.get("fallback_allowed") is not False:
        sys.exit("Scoped code-validation evidence must record fallback_allowed=false.")
    if not embedding.get("requested_revision"):
        sys.exit("Scoped code-validation evidence must record the requested BGE revision.")
    if embedding.get("revision_enforced_for_remote_loading") is not True:
        sys.exit("Scoped code-validation evidence must enforce the requested BGE revision.")
    if embedding.get("source") == "packaged-local" and not embedding.get(
        "model_bundle_sha256"
    ):
        sys.exit("Packaged BGE evidence must include a model-bundle hash.")
    inputs = manifest.get("inputs") or {}
    if not inputs.get("sampling_report") or not inputs.get("sampling_report_sha256"):
        sys.exit("Scoped code-validation evidence must include the sampling report.")
    return manifest


def verify_human_evidence(manifest):
    embedding = manifest.get("embedding") or {}
    if embedding.get("backend") != "strict local BGE":
        sys.exit("The 54-pair manifest does not record strict local BGE.")
    if embedding.get("fallback_allowed") is not False:
        sys.exit("The 54-pair manifest must record fallback_allowed=false.")


def report_date(*timestamps):
    parsed = []
    for value in timestamps:
        if not value:
            continue
        try:
            parsed.append(datetime.fromisoformat(value.replace("Z", "+00:00")))
        except (TypeError, ValueError):
            continue
    selected = max(parsed) if parsed else datetime.now()
    return f"{selected.strftime('%B')} {selected.day}, {selected.year}"


def build_current_validation_study():
    out = os.path.join(HERE, "Synthesis_Fit_Validation_Study.pdf")
    paths, using_local_artifacts = study_paths()
    metrics = load_json(paths["code_metrics"])
    human_metrics = load_json(paths["human_metrics"])
    human_manifest = load_json(paths["human_manifest"])
    code_manifest = verify_code_evidence(metrics)
    verify_human_evidence(human_manifest)

    if using_local_artifacts:
        snapshot_paths = {
            "code_metrics": os.path.join(
                SNAPSHOT_DIR,
                "code-validation-summary.json",
            ),
            "human_metrics": os.path.join(
                SNAPSHOT_DIR,
                "human-validation-summary.json",
            ),
            "human_manifest": os.path.join(
                SNAPSHOT_DIR,
                "human-validation-manifest.json",
            ),
        }
        code_snapshot = dict(metrics)
        code_snapshot.pop("figures", None)
        write_json(snapshot_paths["code_metrics"], code_snapshot)
        write_json(snapshot_paths["human_metrics"], human_metrics)
        write_json(snapshot_paths["human_manifest"], human_manifest)
        write_json(
            os.path.join(SNAPSHOT_DIR, "snapshot-checksums.json"),
            {
                "schema_version": 1,
                "generated_at": datetime.now().astimezone().isoformat(),
                "sources": {
                    key: {
                        "path": os.path.relpath(path, REPO).replace("\\", "/"),
                        "sha256": sha256_file(path),
                    }
                    for key, path in paths.items()
                },
                "snapshots": {
                    key: {
                        "path": os.path.relpath(path, REPO).replace("\\", "/"),
                        "sha256": sha256_file(path),
                    }
                    for key, path in snapshot_paths.items()
                },
                "note": (
                    "These committed summaries contain no resume or job-description "
                    "text. Raw validation artifacts remain local and gitignored."
                ),
            },
        )

    arms = metrics["arms"]
    best_arm = metrics["best_arm"]
    labels = metrics["labels"]
    jd_diag = metrics.get("jd_parse_diagnostics") or {}
    human_methods = human_metrics["methods"]
    selected_pair_arm = "hybrid_0_25"
    selected_pair_metrics = human_methods[selected_pair_arm]
    kendall_best_arm = max(
        human_methods,
        key=lambda key: human_methods[key]["kendall_tau_b"],
    )
    threshold_best_arm = max(
        human_methods,
        key=lambda key: human_methods[key]["balanced_accuracy"],
    )
    date_label = report_date(
        code_manifest.get("generated_at"),
        human_metrics.get("completed_at"),
    )
    code_embedding = code_manifest["embedding"]
    embedding_evidence = (
        f"Embedding evidence: strict BGE backend, model {code_embedding['model']}, "
        f"requested revision {code_embedding['requested_revision']} enforced for remote loading"
    )
    if code_embedding.get("model_bundle_sha256"):
        embedding_evidence += (
            f", packaged-model bundle SHA-256 "
            f"{code_embedding['model_bundle_sha256'][:16]}..."
        )
    embedding_evidence += ", with no fallback."

    doc = SimpleDocTemplate(
        out,
        pagesize=letter,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        title="Synthesis - Fit Validation Study",
        author="Team Cynthese",
    )

    story = []
    story.append(P("Synthesis Fit Validation Study", H1))
    story.append(
        P(
            "Family-normalized code validation and raw pair-level human validation",
            SUB,
        )
    )

    story.append(P("Executive Summary", H2))
    story.append(P(
        "This report contains two separate validation studies. Code validation is a large-sample occupational-family "
        "proxy test. Human validation is a smaller blinded pair-level test against independent rubric judgments. "
        "They use the same structured weights and underlying scorers, but they use different aggregation, units, "
        "metrics, and claims.",
    ))
    rows = [["Study", "Question answered", "Evaluation unit", "Primary evidence"]]
    rows.extend([
        [
            P("<b>Code validation</b>", CELLB),
            P("Does a resume score highest against real JDs from its own occupational family?", CELL),
            P(
                f"{metrics['n_resumes']} resumes evaluated across "
                f"{sum(metrics.get('jd_counts', {}).values())} parsed JDs in three families.",
                CELL,
            ),
            P("Top-1 accuracy, mean rank, MRR, margin, and family confusion.", CELL),
        ],
        [
            P("<b>Human validation</b>", CELLB),
            P("Do arm scores rank specific resume-JD pairs in the same direction as human judgments?", CELL),
            P(
                f"{human_metrics['analyzable_pairs']} unique real resume-JD pairs "
                "reviewed in one blinded session.",
                CELL,
            ),
            P("Spearman, Kendall tau-b, pairwise ordering, and diagnostic label metrics.", CELL),
        ],
    ])
    story.append(table(rows, [1.15 * inch, 2.25 * inch, 1.85 * inch, 1.85 * inch], font=7.9))
    story.append(Spacer(1, 6))
    story += dash_items([
        f"<b>Code validation result:</b> the best pre-specified method is {code_arm_name(best_arm)}, with top-1 accuracy of "
        f"<b>{pct(arms[best_arm]['top1'])}</b>, MRR of <b>{fmt(arms[best_arm]['mrr'])}</b>, and mean rank of "
        f"<b>{fmt(arms[best_arm]['mean_rank'], 2)}</b>.",
        f"<b>Human validation result:</b> {pair_arm_name(selected_pair_arm)} produced Spearman "
        f"<b>{fmt(selected_pair_metrics['spearman_rho'])}</b> and pairwise ordering "
        f"<b>{fmt(selected_pair_metrics['pairwise_ordering_accuracy'])}</b>, the highest values "
        "for those measures among the five pre-specified arms.",
        "<b>Combined decision:</b> the two studies support retaining hybrid 0.25. They do not establish that every "
        "individual fit score or product score band is accurate.",
        "<b>Change scope:</b> this report does not add a score "
        "transformation, new threshold, or production deployment.",
    ])

    story.append(PageBreak())
    story.append(P("Part I - Code Validation", PART))
    story.append(P("Large-sample occupational-family proxy evaluation", PARTSUB))

    story.append(P("Code Validation Question", H2))
    story.append(P(
        "The production Fit Analyzer is a one-JD-to-one-resume scorer. A family-level task cannot prove that a "
        "specific score is correct for a specific pair. Instead, this validation asks a narrower question: does a "
        "scoring method generally place a resume closer to postings from its own occupational family than to "
        "postings from other scoped families?",
    ))

    story.append(P("Code Validation Design", H2))
    story += dash_items([
        "Input data: local resume and posting datasets stored under the repo's gitignored Datasets directory.",
        "Family mapping: candidate postings are classified by the LLM mapper into 21 retained families plus UNMAPPED; "
        "the current validation filters to Consultant, Finance, and Information Technology.",
        f"JD sampling: {code_manifest['inputs']['jd_rows']} high-confidence postings are collected across the "
        "three scoped families before parser gating.",
        "Parser gate: selected JDs are parsed with production parseJD(); the main study keeps JDs with at least "
        "three parsed requirements.",
        "Scoring unit: each resume is scored against every retained JD. Raw pair scores are averaged by JD family.",
        "Hybrid aggregation: the structured and semantic family-average maps are independently min-max normalized "
        "per resume, then blended. The highest resulting family score is the prediction.",
        embedding_evidence,
    ])

    story.append(P("Code Validation Dataset After Parsing", H2))
    jd_counts = metrics.get("jd_counts", {})
    rows = [["Family", "Resumes", "JDs kept", "JDs originally sampled"]]
    for label in labels:
        n_res = arms[best_arm]["per_family"][label]["n"]
        original_count = (jd_diag.get("original_counts") or {}).get(label, "")
        rows.append([
            P(display_family(label), CELL),
            P(str(n_res), CELL),
            P(str(jd_counts.get(label, "")), CELL),
            P(str(original_count), CELL),
        ])
    rows.append([P("<b>Total</b>", CELLB), P(f"<b>{metrics['n_resumes']}</b>", CELLB),
                 P(f"<b>{sum(jd_counts.values())}</b>", CELLB),
                 P(f"<b>{jd_diag.get('total', code_manifest['inputs']['jd_rows'])}</b>", CELLB)])
    story.append(table(rows, [2.4 * inch, 1.1 * inch, 1.1 * inch, 1.5 * inch]))

    if jd_diag:
        story.append(P(
            f"The parseability gate kept <b>{jd_diag['kept']}</b> of <b>{jd_diag['total']}</b> postings. "
            f"The threshold was at least <b>{jd_diag['min_jd_requirements']}</b> parsed requirements per JD.",
        ))
        rows = [["Family", "Kept", "Dropped", "Mean req.", "Median req.", "Zero req."]]
        for label, stats in jd_diag.get("families", {}).items():
            rows.append([
                P(display_family(label), CELL),
                P(f"{stats['kept']}/{stats['total']}", CELL),
                P(str(stats["dropped"]), CELL),
                P(f"{stats['mean']:.2f}", CELL),
                P(f"{stats['median']:.1f}", CELL),
                P(str(stats["zero_requirement"]), CELL),
            ])
        story.append(table(rows, [2.1 * inch, 0.75 * inch, 0.8 * inch, 0.85 * inch, 0.95 * inch, 0.85 * inch]))

    story.append(PageBreak())
    story.append(P("Code Validation Methods Compared", H2))
    rows = [["Method", "Description", "Production interpretation"]]
    rows.append([
        P("Rules-only structured", CELLB),
        P("Current deterministic scoreFit() logic: O*NET-grounded skill extraction, requirement status, gaps, and evidence.", CELL),
        P("Strong baseline and most interpretable path.", CELL),
    ])
    rows.append([
        P("Embedding-only semantic", CELLB),
        P("Requirement-level semantic retrieval over resume evidence chunks using local BGE-small embeddings.", CELL),
        P("Tests whether semantic similarity aligns better with human-like fit judgement.", CELL),
    ])
    rows.append([
        P("Hybrid arms", CELLB),
        P(
            "Per-resume family-normalized blend of structured and semantic family-average maps, using structured "
            "weights 0.25, 0.50, and 0.75.",
            CELL,
        ),
        P(
            "A proxy aggregation for occupational-family discrimination; it is not the production pair formula.",
            CELL,
        ),
    ])
    story.append(table(rows, [1.55 * inch, 3.25 * inch, 2.3 * inch]))

    story.append(P("Code Validation Headline Results", H2))
    rows = [["Arm", "Top-1", "Mean rank", "MRR", "Mean margin"]]
    for key in ["structured", "embedding", "hybrid_0_25", "hybrid_0_5", "hybrid_0_75"]:
        a = arms[key]
        rows.append([
            P(
                f"<b>{code_arm_name(key)}</b>" if key == best_arm else code_arm_name(key),
                CELLB if key == best_arm else CELL,
            ),
            P(f"<b>{pct(a['top1'])}</b>" if key == best_arm else pct(a["top1"]), CELLB if key == best_arm else CELL),
            P(fmt(a["mean_rank"], 2), CELL),
            P(fmt(a["mrr"]), CELL),
            P(fmt(a["mean_margin"], 2), CELL),
        ])
    story.append(table(rows, [2.9 * inch, 0.8 * inch, 0.9 * inch, 0.75 * inch, 0.9 * inch]))
    story.append(P(
        "Top-3 accuracy is intentionally not reported as a headline metric because this validation has only three "
        "families. The more informative metrics are top-1, mean rank, MRR, margin, and the confusion matrix.",
        SMALL,
    ))

    story.append(PageBreak())
    story.append(P("Code Validation Per-Family Findings", H2))
    rows = [["Family", "Structured", "Embedding", "Hybrid 0.25"]]
    for label in labels:
        rows.append([
            P(display_family(label), CELL),
            P(pct(arms["structured"]["per_family"][label]["top1"]), CELL),
            P(pct(arms["embedding"]["per_family"][label]["top1"]), CELL),
            P(pct(arms["hybrid_0_25"]["per_family"][label]["top1"]), CELL),
        ])
    story.append(table(rows, [2.5 * inch, 1.25 * inch, 1.25 * inch, 1.3 * inch]))
    story.append(P(
        "Finance is the strongest family, embedding materially improves IT, and Consultant is the hardest family "
        "because business, finance, and consulting language overlap.",
        SMALL,
    ))

    story.append(P("Code Validation Confusion Matrix - Best Arm", H2))
    story.append(P("Rows are true resume families; columns are predicted families. Values are resume counts.", SMALL))
    cm = arms[best_arm]["confusion_matrix"]
    rows = [["True / Predicted"] + [display_family(label) for label in labels]]
    for true in labels:
        rows.append([P(display_family(true), CELLB)] + [P(str(cm.get(true, {}).get(pred, 0)), CELL) for pred in labels])
    story.append(table(rows, [1.8 * inch, 1.55 * inch, 1.2 * inch, 2.0 * inch]))

    story.append(P("Code Validation Interpretation", H2))
    story += dash_items([
        f"The family-normalized hybrid 0.25 arm is the best pre-specified family-level proxy method at "
        f"{pct(arms[best_arm]['top1'])} top-1 accuracy. It balances semantic flexibility with rules-based grounding.",
        "No formal success threshold was pre-registered for this proxy study, so the result is reported as a "
        "comparative arm outcome rather than a pass/fail claim.",
        "Consultant is the main failure mode because its language overlaps with the other scoped families. Some "
        "cross-family errors may still represent reasonable transferability in the production task.",
    ])

    story.append(P("Code Validation Limitations", H2))
    story += dash_items([
        "<b>Proxy task:</b> family top-1 measures coarse occupational discrimination, not one-pair fit accuracy.",
        "<b>Labels and scope:</b> posting families come from the LLM mapper, and only three families are included.",
        "<b>Parser and transferability:</b> parser errors can affect scores, while reasonable cross-family fits are "
        "counted as wrong by the proxy task.",
    ])

    story.append(PageBreak())
    story.append(P("Part II - Human Validation", PART))
    story.append(P("Blinded pair-level comparison against rubric-based human judgments", PARTSUB))

    story.append(P("Human Validation Question and Design", H2))
    story.append(P(
        "The pair-level study tests the production question more directly: whether a specific resume is a weak, "
        "medium, or strong fit for a specific real JD. The reviewer completed all judgments before arm scores "
        "or arm labels were merged into the comparison file.",
    ))
    story += dash_items([
        f"<b>Source:</b> the same frozen real-data pool used by code validation: "
        f"{human_manifest['sampling']['eligible_resumes']} eligible resumes and "
        f"{human_manifest['sampling']['eligible_jds']} eligible JDs.",
        f"<b>Candidate pool:</b> {human_manifest['sampling']['candidate_pairs']} scored combinations; "
        f"{human_manifest['sampling']['final_pairs']} unique resumes and "
        f"{human_manifest['sampling']['final_pairs']} unique JDs were selected.",
        "<b>Stratification:</b> 6 pairs in every JD-family by LOW/MID/HIGH band cell "
        "(3 families x 3 bands x 6 pairs), including 18 cross-family stress pairs.",
        "<b>Selection priority:</b> within each cell, pairs with greater disagreement across the five arms were "
        "selected first. The sample is designed for method comparison, not prevalence estimation.",
        "<b>Blinding:</b> one review session; arm scores, arm labels, source-family fields, and selection bands "
        "were hidden during review. No second session was included.",
        "<b>Arms:</b> structured, embedding, hybrid 0.25, hybrid 0.50, and hybrid 0.75. Semantic scoring used "
        "strict local BGE-small embeddings with no fallback.",
        "<b>Pair formula:</b> each hybrid directly blends raw 0-100 structured and semantic pair scores. No "
        "min-max normalization, score transformation, or calibration is applied.",
    ])

    story.append(P("Human Validation Labelling Rubric", H2))
    rows = [["Dimension", "0", "1", "2"]]
    rubric = [
        ("Core requirements", "Few core requirements met", "Some met with meaningful gaps", "Most important requirements met"),
        ("Evidence quality", "Little relevant evidence", "Adjacent or weak evidence", "Direct and specific evidence"),
        ("Seniority and scope", "Material mismatch", "Partly comparable", "Comparable level and complexity"),
        ("Gating requirements", "Clear gating item absent", "Uncertain or partly met", "No material gating gap"),
    ]
    for row in rubric:
        rows.append([P(row[0], CELLB), P(row[1], CELL), P(row[2], CELL), P(row[3], CELL)])
    story.append(table(rows, [1.65 * inch, 1.75 * inch, 1.75 * inch, 1.95 * inch]))
    story.append(P(
        "The four scores sum to a human total from 0 to 8. Totals 0-2 are Weak, totals 3-5 are Medium, and "
        "totals 6-8 are Strong. A zero on gating requirements caps the label at Medium. The comparison file "
        "contains only these four rubric scores, the total, the human label, and the five arm score/label pairs.",
    ))

    story.append(P("Human Validation Label Distribution", H2))
    label_counts = human_metrics["label_counts"]
    human_n = human_metrics["analyzable_pairs"]
    rows = [["Label", "Count", "Share"]]
    for label in ["WEAK", "MEDIUM", "STRONG"]:
        rows.append([
            P(label.title(), CELL),
            P(str(label_counts[label]), CELL),
            P(pct(label_counts[label] / human_n), CELL),
        ])
    rows.append([P("<b>Total</b>", CELLB), P(f"<b>{human_n}</b>", CELLB), P("<b>100.0%</b>", CELLB)])
    story.append(table(rows, [2.5 * inch, 1.2 * inch, 1.3 * inch]))

    story.append(PageBreak())
    story.append(P("Human Validation Five-Arm Results", H2))
    rows = [["Arm", "Spearman", "Kendall", "Pairwise", "Balanced acc.", "Macro F1", "Ordinal MAE"]]
    for key in ["structured", "embedding", "hybrid_0_25", "hybrid_0_5", "hybrid_0_75"]:
        result = human_methods[key]
        best = key == "hybrid_0_25"
        cell_style = CELLB if best else CELL
        label = f"<b>{pair_arm_name(key)}</b>" if best else pair_arm_name(key)
        rows.append([
            P(label, cell_style),
            P(f"<b>{fmt(result['spearman_rho'])}</b>" if best else fmt(result["spearman_rho"]), cell_style),
            P(fmt(result["kendall_tau_b"]), CELL),
            P(f"<b>{fmt(result['pairwise_ordering_accuracy'])}</b>" if best else fmt(result["pairwise_ordering_accuracy"]), cell_style),
            P(fmt(result["balanced_accuracy"]), CELL),
            P(fmt(result["macro_f1"]), CELL),
            P(fmt(result["ordinal_mae"]), CELL),
        ])
    story.append(table(rows, [1.85 * inch, 0.8 * inch, 0.75 * inch, 0.85 * inch, 0.85 * inch, 0.75 * inch, 0.75 * inch], font=7.8))
    story.append(P(
        f"{pair_arm_name(selected_pair_arm)} has the highest Spearman correlation "
        f"({fmt(selected_pair_metrics['spearman_rho'])}) and pairwise ordering accuracy "
        f"({fmt(selected_pair_metrics['pairwise_ordering_accuracy'])}). "
        f"{pair_arm_name(kendall_best_arm)} has the highest Kendall tau-b "
        f"({fmt(human_methods[kendall_best_arm]['kendall_tau_b'])}), compared with "
        f"{fmt(selected_pair_metrics['kendall_tau_b'])} for hybrid 0.25. "
        "The correlations are positive but modest, so the result supports relative arm selection rather than "
        "a claim of high absolute agreement.",
        SMALL,
    ))

    story.append(P("Human Validation Interpretation", H2))
    story += dash_items([
        "<b>Pair-level rank evidence:</b> hybrid 0.25 is best on the two most decision-relevant human-study "
        "ranking measures: Spearman correlation and pairwise ordering accuracy.",
        f"<b>Kendall qualification:</b> {pair_arm_name(kendall_best_arm)} has a slightly higher Kendall tau-b than "
        "hybrid 0.25, so no single arm leads every rank measure.",
        f"<b>Threshold metrics do not overturn the decision:</b> {pair_arm_name(threshold_best_arm)} has the highest "
        "balanced accuracy under the pre-specified three-level validation mapping at 45 and 65. The mapping "
        "combines the product's 65-79 and 80+ presentation bands as Strong, so it does not validate the 80 cut "
        "point separately. These metrics remain secondary because they are highly dependent on each arm's raw "
        "score scale.",
        "<b>Human-study conclusion:</b> among the five pre-specified arms, the primary pair-level rank evidence "
        "supports hybrid 0.25, while the modest effect sizes limit claims of absolute agreement.",
        "<b>No new calibration:</b> human totals were not multiplied or transformed, and the product score "
        "boundaries were not changed or tuned after review.",
    ])

    story.append(P("Human Validation Limitations", H2))
    story += dash_items([
        "<b>Single reviewer:</b> the study measures agreement with one blinded judgment set and does not estimate "
        "inter-rater reliability.",
        "<b>Stratified sample:</b> equal LOW/MID/HIGH cells and within-cell disagreement enrichment support arm "
        "comparison but do not estimate natural production prevalence.",
        "<b>Modest association:</b> all rank correlations are below 0.30, so the study does not establish strong "
        "human-system agreement.",
        "<b>Scale effects:</b> the five arms occupy different raw score ranges, making fixed-boundary label metrics "
        "less suitable than rank measures for choosing among arms in this study.",
        "<b>Human labels:</b> written resume and JD evidence was reviewed without external credential verification.",
    ])

    story.append(PageBreak())
    story.append(P("Combined Decision and Reporting Position", PART))
    story.append(P("How the two validation studies contribute to the final decision", PARTSUB))
    rows = [["Study", "What it supports", "What it does not establish"]]
    rows.extend([
        [
            P("<b>Code validation</b>", CELLB),
            P("Relative arm performance on coarse occupational-family discrimination at larger sample scale.", CELL),
            P("Correctness of a specific resume-JD score or the validity of product score bands.", CELL),
        ],
        [
            P("<b>Human validation</b>", CELLB),
            P("Relative arm performance on pair-level ordering against 54 blinded rubric judgments.", CELL),
            P("Natural production prevalence, inter-rater reliability, or absolute score-band validity.", CELL),
        ],
    ])
    story.append(table(rows, [1.25 * inch, 2.75 * inch, 3.1 * inch], font=8.1))
    story.append(Spacer(1, 8))
    story.append(P(
        "Code validation provides the larger-sample evidence that hybrid 0.25 preserves the strongest coarse "
        "occupational-family signal among the pre-specified arms. Human validation provides the more task-direct "
        "evidence that hybrid 0.25 leads the main pair-level ranking measures. Together they support retaining "
        "hybrid 0.25 as the production Fit Analyzer arm. Neither study establishes that the current score bands "
        "are human-validated, and no new thresholds were introduced.",
    ))
    story.append(P(
        "Reproducibility: raw study artifacts remain offline and gitignored. De-identified summary metrics, "
        "manifests, and checksums are stored under reports/fit-validation so the reported evidence can be audited "
        "without publishing resume or job-description text.",
        SMALL,
    ))

    footer = footer_for(date_label)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return out


if __name__ == "__main__":
    path = build_current_validation_study()
    print("Wrote:")
    print(f"  {path}  ({os.path.getsize(path) // 1024} KB)")
