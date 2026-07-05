#!/usr/bin/env python3
"""
Build the current Synthesis Fit Validation Study PDF.

Run:
  python reports/build_reports.py
"""

from __future__ import annotations

import json
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
ART = os.path.join(REPO, "scripts", "validation", ".artifacts")

NAVY = colors.HexColor("#1f3a5f")
GREY = colors.HexColor("#64748b")
LIGHT = colors.HexColor("#f1f5f9")

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Title"], textColor=NAVY, fontSize=22, spaceAfter=4, alignment=TA_LEFT)
SUB = ParagraphStyle("SUB", parent=styles["Normal"], textColor=GREY, fontSize=9.5, spaceAfter=10)
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


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(0.7 * inch, 0.5 * inch, "Synthesis Fit Validation Study - July 5, 2026")
    canvas.drawRightString(letter[0] - 0.7 * inch, 0.5 * inch, f"Page {doc.page}")
    canvas.restoreState()


def pct(x):
    return f"{100 * float(x):.1f}%"


def fmt(x, digits=3):
    return f"{float(x):.{digits}f}"


def arm_name(key):
    return {
        "structured": "Rules-only structured",
        "embedding": "Embedding-only semantic",
        "hybrid_0_25": "Hybrid 0.25 rules / 0.75 semantic",
        "hybrid_0_5": "Hybrid 0.50 rules / 0.50 semantic",
        "hybrid_0_75": "Hybrid 0.75 rules / 0.25 semantic",
    }.get(key, key)


def display_family(label):
    return {
        "CONSULTANT": "Consultant",
        "FINANCE": "Finance",
        "INFORMATION-TECHNOLOGY": "IT",
    }.get(label, label)


def metrics_path():
    path = os.path.join(ART, "metrics.scoped.json")
    if not os.path.exists(path):
        sys.exit("Missing scripts/validation/.artifacts/metrics.scoped.json - run npm run validate:report first.")
    return path


def build_current_validation_study():
    out = os.path.join(HERE, "Synthesis_Fit_Validation_Study.pdf")
    metrics = json.load(open(metrics_path(), encoding="utf-8"))
    arms = metrics["arms"]
    best_arm = metrics["best_arm"]
    labels = metrics["labels"]
    jd_diag = metrics.get("jd_parse_diagnostics") or {}

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
    story.append(P("Current scoped real-JD validation, production-fit interpretation, and proposed human check", SUB))

    story.append(P("Executive Summary", H2))
    story.append(P(
        "This study evaluates whether the Synthesis Fit Analyzer preserves a coarse occupational signal when "
        "scoring real resumes against real job postings. The current validation is scoped to three O*NET-aligned "
        "families: Consultant, Finance, and Information Technology. Each resume is scored against posting-level "
        "JDs from each family, and the method is credited when the true family receives the highest average score.",
    ))
    story += dash_items([
        f"The best pre-specified method is <b>{arm_name(best_arm)}</b>, with top-1 accuracy of "
        f"<b>{pct(arms[best_arm]['top1'])}</b>, MRR of <b>{fmt(arms[best_arm]['mrr'])}</b>, and mean rank of "
        f"<b>{fmt(arms[best_arm]['mean_rank'], 2)}</b>.",
        "This is strong enough for a graduate course validation study, but it should be interpreted as a coarse "
        "discriminative sanity check, not as direct pairwise fit accuracy.",
        "A post-hoc grid search over hybrid weights found a maximum family-level top-1 of 68.8 percent at "
        "structured weight 0.15. Because that was test-set tuning and did not cross the 70 percent threshold, "
        "the report keeps the pre-specified hybrid 0.25 as the main candidate.",
        "The next, more task-valid evaluation should manually label 40-60 JD-resume pairs as strong, medium, "
        "or weak fit and test whether analyzer scores rank them in that order.",
    ])

    story.append(P("Why This Validation Exists", H2))
    story.append(P(
        "The production Fit Analyzer is a one-JD-to-one-resume scorer. A family-level task cannot prove that a "
        "specific score is correct for a specific pair. Instead, this validation asks a narrower question: does a "
        "scoring method generally place a resume closer to postings from its own occupational family than to "
        "postings from other scoped families?",
    ))

    story.append(P("Study Design", H2))
    story += dash_items([
        "Input data: local resume and posting datasets stored under the repo's gitignored Datasets directory.",
        "Family mapping: candidate postings are classified by the LLM mapper into 21 retained families plus UNMAPPED; "
        "the current validation filters to Consultant, Finance, and Information Technology.",
        "JD sampling: 100 high-confidence postings are collected for each scoped family before scoring.",
        "Parser gate: selected JDs are parsed with production parseJD(); the main study keeps JDs with at least "
        "three parsed requirements.",
        "Scoring unit: each resume is scored against every retained JD. Scores are averaged by JD family, and the "
        "highest average score is the predicted family.",
    ])

    story.append(P("Dataset After Parsing", H2))
    jd_counts = metrics.get("jd_counts", {})
    rows = [["Family", "Resumes", "JDs kept", "JDs originally sampled"]]
    for label in labels:
        n_res = arms[best_arm]["per_family"][label]["n"]
        rows.append([P(display_family(label), CELL), P(str(n_res), CELL), P(str(jd_counts.get(label, "")), CELL), P("100", CELL)])
    rows.append([P("<b>Total</b>", CELLB), P(f"<b>{metrics['n_resumes']}</b>", CELLB),
                 P(f"<b>{sum(jd_counts.values())}</b>", CELLB), P("<b>300</b>", CELLB)])
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

    story.append(P("Methods Compared", H2))
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
        P("Per-resume min-max blend of structured and embedding family scores with structured weights 0.25, 0.50, and 0.75.", CELL),
        P("Hybrid 0.25 is now the production candidate, subject to human check.", CELL),
    ])
    story.append(table(rows, [1.55 * inch, 3.25 * inch, 2.3 * inch]))

    story.append(P("Headline Results", H2))
    rows = [["Arm", "Top-1", "Mean rank", "MRR", "Mean margin"]]
    for key in ["structured", "embedding", "hybrid_0_25", "hybrid_0_5", "hybrid_0_75"]:
        a = arms[key]
        rows.append([
            P(f"<b>{arm_name(key)}</b>" if key == best_arm else arm_name(key), CELLB if key == best_arm else CELL),
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

    story.append(P("Per-Family Findings", H2))
    rows = [["Family", "Structured", "Embedding", "Hybrid 0.25", "Main observation"]]
    observations = {
        "CONSULTANT": "Hardest family; business, finance, and consulting language overlaps heavily.",
        "FINANCE": "Very strong across structured-heavy methods; financial requirements are distinctive.",
        "INFORMATION-TECHNOLOGY": "Embedding improves sharply after parser robustness fixes.",
    }
    for label in labels:
        rows.append([
            P(display_family(label), CELL),
            P(pct(arms["structured"]["per_family"][label]["top1"]), CELL),
            P(pct(arms["embedding"]["per_family"][label]["top1"]), CELL),
            P(pct(arms["hybrid_0_25"]["per_family"][label]["top1"]), CELL),
            P(observations[label], CELL),
        ])
    story.append(table(rows, [1.9 * inch, 0.85 * inch, 0.85 * inch, 0.9 * inch, 2.6 * inch]))

    story.append(P("Confusion Matrix - Best Arm", H2))
    story.append(P("Rows are true resume families; columns are predicted families. Values are resume counts.", SMALL))
    cm = arms[best_arm]["confusion_matrix"]
    rows = [["True / Predicted"] + [display_family(label) for label in labels]]
    for true in labels:
        rows.append([P(display_family(true), CELLB)] + [P(str(cm.get(true, {}).get(pred, 0)), CELL) for pred in labels])
    story.append(table(rows, [1.8 * inch, 1.55 * inch, 1.2 * inch, 2.0 * inch]))

    story.append(P("Interpretation", H2))
    story += dash_items([
        "The hybrid 0.25 arm is the best pre-specified family-level proxy method. It balances semantic flexibility "
        "with some rules-based grounding.",
        "The 70 percent threshold is not formally met. However, 68.0 percent on 353 resumes is close enough that the "
        "result should be discussed as near-threshold rather than as a hard method failure.",
        "Consultant is the main failure mode. This is expected because consultant resumes and JDs often share general "
        "business, analysis, stakeholder, strategy, and finance vocabulary with the other scoped families.",
        "Family-level errors can be reasonable transferability cases. A consultant resume scoring highly for a finance "
        "analyst JD is not necessarily a bad fit in the production task.",
    ])

    story.append(P("Limitations", H2))
    story += dash_items([
        "<b>Proxy task:</b> family top-1 measures coarse occupational discrimination, not one-pair fit accuracy.",
        "<b>Label source:</b> posting family labels come from the LLM mapper and have not yet been human-checked.",
        "<b>Scope:</b> only three families are included, so results should not be generalized to all O*NET families.",
        "<b>Parser dependency:</b> the study depends on parseResume() and parseJD(); parser errors can affect scores.",
        "<b>Ambiguous fit:</b> cross-family transferability is treated as wrong by family top-1 even when it may be "
        "reasonable for a real applicant.",
        "<b>Weight tuning:</b> a post-hoc sensitivity check found 68.8 percent at structured weight 0.15, but this is "
        "not adopted as the main method because it would tune to the family proxy test set.",
    ])

    story.append(P("Proposed Human Check", H2))
    story.append(P(
        "The next validation should be a smaller but more task-valid pair-level study. Instead of asking whether a "
        "resume belongs to the same broad family as a JD, it should ask whether a specific resume is a strong, "
        "medium, or weak fit for a specific JD.",
    ))
    story += dash_items([
        "Sample 40-60 JD-resume pairs, stratified by analyzer score: about one third high-score, one third middle-score, "
        "and one third low-score pairs.",
        "Include all three scoped JD families and a few plausible cross-family pairs, especially Consultant versus Finance.",
        "Hide analyzer scores during labelling to reduce confirmation bias.",
        "Label each pair with a fixed rubric, then compare rules-only, embedding-only, and hybrid 0.25 against those labels.",
    ])

    story.append(P("Human Labelling Rubric", H2))
    rows = [["Dimension", "0", "1", "2"]]
    rubric = [
        ("Core skills match", "Most must-have skills missing", "Some core skills matched", "Most core skills matched"),
        ("Experience and domain", "Clearly unrelated", "Transferable overlap", "Highly related work/domain"),
        ("Seniority and years", "Clearly below or mismatched", "Close but imperfect", "Meets level and years"),
        ("Education or hard constraints", "Hard requirement missing", "Unclear or partial", "Meets or not required"),
    ]
    for row in rubric:
        rows.append([P(row[0], CELLB), P(row[1], CELL), P(row[2], CELL), P(row[3], CELL)])
    story.append(table(rows, [1.65 * inch, 1.75 * inch, 1.75 * inch, 1.95 * inch]))
    story.append(P(
        "Total score mapping: 0-3 = Weak fit, 4-6 = Medium fit, 7-8 = Strong fit. This makes human labels more "
        "objective than a single impressionistic judgement.",
    ))

    story.append(P("Human Check Metrics", H2))
    story += dash_items([
        "<b>Spearman correlation:</b> analyzer score versus human total score.",
        "<b>Mean score monotonicity:</b> Strong pairs should have higher average analyzer scores than Medium, which "
        "should be higher than Weak.",
        "<b>Pairwise ordering accuracy:</b> for two pairs with different human labels, the method should rank the "
        "stronger human label higher.",
        "<b>Optional threshold view:</b> inspect whether score bands can map to strong, medium, and weak recommendations.",
    ])

    story.append(P("Recommended Reporting Position", H2))
    story.append(P(
        "Use the current family-level validation as large-scale supporting evidence, not as the final claim of pairwise "
        "accuracy. The main claim should be: hybrid semantic-plus-rules scoring shows stronger coarse occupational "
        "signal than rules alone, with hybrid 0.25 as the best pre-specified validation arm. Final production calibration "
        "should be based on the proposed human-labelled JD-resume pair study.",
    ))
    story.append(P(
        "Reproducibility: run npm run validate:prep, npm run validate:fit, and npm run validate:report. The report uses "
        "scripts/validation/.artifacts/metrics.scoped.json generated by that pipeline.",
        SMALL,
    ))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return out


if __name__ == "__main__":
    path = build_current_validation_study()
    print("Wrote:")
    print(f"  {path}  ({os.path.getsize(path) // 1024} KB)")
