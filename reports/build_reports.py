#!/usr/bin/env python3
"""
Build the two shareable Synthesis deliverable PDFs into reports/:

  1. Synthesis_Progress_Report.pdf        — the audit vs Proposal Final V2 (team-facing).
  2. Synthesis_Fit_Validation_Study.pdf   — Deliverable #2: metrics + confusion matrices + ablation.

Run:  python3 reports/build_reports.py
"""

from __future__ import annotations

import json
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, ListFlowable, ListItem,
)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
ART = os.path.join(REPO, "scripts", "validation", ".artifacts")
FIGS = os.path.join(HERE, "figs")
os.makedirs(FIGS, exist_ok=True)

NAVY = colors.HexColor("#1f3a5f")
ACCENT = colors.HexColor("#2563eb")
GREEN = colors.HexColor("#15803d")
AMBER = colors.HexColor("#b45309")
RED = colors.HexColor("#b91c1c")
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

USABLE_W = letter[0] - 1.4 * inch


def P(t, s=BODY):
    return Paragraph(t, s)


def bullets(items, s=BODY):
    return ListFlowable([ListItem(P(i, s), leftIndent=10) for i in items],
                        bulletType="bullet", start="•", leftIndent=12)


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


def fit_image(path, max_w=USABLE_W):
    iw, ih = ImageReader(path).getSize()
    w = min(max_w, iw)
    return Image(path, width=w, height=w * ih / iw)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(0.7 * inch, 0.5 * inch, "Synthesis · Team Cynthése · BUSA 649")
    canvas.drawRightString(letter[0] - 0.7 * inch, 0.5 * inch, f"Page {doc.page}")
    canvas.restoreState()


# --------------------------------------------------------------------------- #
# PDF 1 — Progress Report
# --------------------------------------------------------------------------- #
def build_progress_report():
    out = os.path.join(HERE, "Synthesis_Progress_Report.pdf")
    doc = SimpleDocTemplate(out, pagesize=letter, topMargin=0.7 * inch, bottomMargin=0.7 * inch,
                            leftMargin=0.7 * inch, rightMargin=0.7 * inch,
                            title="Synthesis — Progress Report", author="Team Cynthése")
    s = []
    s.append(P("Synthesis — Progress Report", H1))
    s.append(P("Repo audit vs. Proposal Final V2 (BUSA 649) &nbsp;·&nbsp; 20 June 2026 &nbsp;·&nbsp; "
               "branch <font face='Courier'>feature/onet-rag-step-2-retriever</font> &nbsp;·&nbsp; "
               "method: static read of app/lib/supabase/scripts/tests/docs + <font face='Courier'>npm test</font> (103 pass)", SUB))

    s.append(P("Executive summary", H2))
    s.append(P("The application engineering is mature and genuinely works; the measured-result science and voice are essentially "
               "not started, and the production data plane (Supabase / pgvector / auth / ingestion / n8n) is scaffolded but dormant. "
               "All three modules run end-to-end today in mock mode and in real (Haiku) mode for the two LLM-scored modules.", BODY))
    s.append(bullets([
        "<b>Fit Analyzer</b> — fully real, deterministic, O*NET-grounded; 0–100 score with per-requirement evidence. Zero Claude cost.",
        "<b>Behavioural Simulator</b> — real JD-driven questions + STAR retrieval + 5-dim rubric scoring (Haiku verified). Text only.",
        "<b>Case Simulator</b> — most complete: pure 8-state FSM (probe / redirect / hint / exhibit-drip / never-skip-scoring), real per-turn + final scoring (Haiku verified), full adaptive chat UI.",
    ]))
    s.append(P("<b>Overall completion vs. full proposal ≈ 60%</b> — app/platform ~75–80%, validation science ~10% "
               "(now built, see companion study), production data plane ~35%, voice 0%. Cost on track: ~$0.015/behavioural, "
               "~$0.063/case, $0/fit — far under the $10 budget.", BODY))

    s.append(P("Completion by dimension", H2))
    rows = [["#", "Dimension", "Est.", "Basis"]]
    for r in [
        ["1", "Resume Fit Analyzer", "85%", "Real engine + UI + API; no upload UI / validation / postings grounding"],
        ["2", "Behavioural Simulator", "85% / 0% voice", "Real eval verified; voice not started"],
        ["3", "Case Simulator", "90%", "FSM + eval + scoring + UI complete & verified"],
        ["4", "O*NET / RAG / pgvector", "40%", "Taxonomy + in-memory retrieval real; pgvector stubbed; 21/1016; no postings"],
        ["5", "Mock vs real mode", "90%", "Dual-mode; real Haiku verified; embeddings real-path unused"],
        ["6", "API routes", "80%", "3 routes work; no persistence/auth"],
        ["7", "UI pages", "85%", "4 polished pages; no upload/voice/auth"],
        ["8", "Tests", "90%", "103 unit tests; no integration-vs-real-services"],
        ["9", "Deployment", "90% mock / 30% real", "Mock-mode live; real needs Supabase + auth"],
    ]:
        rows.append([r[0], P(r[1], CELLB), P(r[2], CELL), P(r[3], CELL)])
    s.append(table(rows, [0.3 * inch, 1.7 * inch, 1.15 * inch, 3.95 * inch]))

    s.append(P("Fully done", H2))
    s.append(bullets([
        "Fit scoring engine (deterministic, O*NET-grounded) — <font face='Courier'>lib/matching.ts</font>, <font face='Courier'>lib/onet.ts</font>",
        "Case FSM with all locked transition rules — <font face='Courier'>lib/fsm/case-fsm.ts</font>",
        "Case + Behavioural evaluators (heuristic mock / Haiku real, with fallback)",
        "Real-mode (Haiku) verification with measured cost — <font face='Courier'>docs/real_mode_verification.md</font>",
        "Mock/real dual-mode architecture; locked schema migrations 0001–0011; two-plane guard test; 103 tests; mock-mode Vercel deploy",
    ]))

    s.append(P("Partially done", H2))
    s.append(bullets([
        "<b>Parsers</b> — heuristic resume/JD + real PDF/DOCX extraction; but no ≥95% robustness measurement, and extraction is regex, not LLM-driven as the proposal states.",
        "<b>O*NET / RAG</b> — taxonomy + in-memory retrieval real; pgvector path is a TODO stub; only 21 of 1,016 occupations; postings corpus not in retrieval.",
        "<b>API routes / UI</b> — work, but no persistence, no auth, no file-upload UI, no voice control.",
        "<b>Embeddings (BGE)</b> — full code path + mock fallback, but never runs (EMBEDDINGS_ENABLED=false everywhere).",
    ]))

    s.append(P("Not started", H2))
    s.append(bullets([
        "Voice (Web Speech API) — named success metric \"behavioural-voice\"; zero code.",
        "Offline ingestion pipeline (clean → chunk → embed → upsert) and n8n workflow — README-only.",
        "Supabase persistence + Auth + RLS in practice — migrations unapplied; client never imported by any route.",
        "Final presentation & write-up (Deliverable #3).",
        "Fit-scorer validation study — <b>was not started; now BUILT</b> (see companion PDF).",
    ]))

    s.append(P("Mocked / stubbed — not production-real", H2))
    s.append(bullets([
        "pgvector retrieval → in-memory lexical; <font face='Courier'>match_onet_chunks</font> RPC never called.",
        "Embeddings → deterministic non-semantic hash by default.",
        "Supabase / persistence / auth → mock client; nothing read or written; fixed mock user id.",
        "Case/behavioural inputs → always authored fixtures, regardless of mode.",
        "O*NET corpus → 21 hand-picked occupations / 84 skills, not 1,016.",
    ]))

    s.append(PageBreak())
    s.append(P("Risks / blockers", H2))
    s.append(bullets([
        "<b>Validation study</b> was the critical-path deliverable and was unstarted (now built; result in companion PDF).",
        "<b>Voice</b> has a hard demo dependency and is 0% — lowest effort, must be scheduled now.",
        "<b>Real mode is all-or-nothing</b> — needs Anthropic + all 3 Supabase vars together or it throws.",
        "<b>Scope-creep trap</b> — the verification doc recommends mock+Haiku for the demo; pgvector/Supabase may be unnecessary for July 30.",
        "<b>Stale counts</b> in CLAUDE.md (81) / deployment doc (86) vs actual 103 tests.",
    ]))

    s.append(P("Team action checklist (proposal §10 roles)", H2))
    rows = [["Member", "Actions"]]
    for who, acts in [
        ("Rui (priority)", "Validation harness is built — review it; run the full + real-embeddings ablation; build the ingestion pipeline + n8n if real RAG is pursued."),
        ("Feroz", "Decide demo posture (mock+Haiku vs real Supabase+pgvector); if real, implement the onet-retrieval pgvector path + wire Supabase/Auth; expand the taxonomy."),
        ("Emmanuel", "Web Speech API voice on behavioural (Chrome + text fallback); file-upload UI (extractText already exists in lib)."),
        ("Ibuken", "More cases/questions; user testing on the live URL; start the write-up; reconcile stale counts."),
    ]:
        rows.append([P(who, CELLB), P(acts, CELL)])
    s.append(table(rows, [1.0 * inch, 6.1 * inch]))

    s.append(P("Critical path — next 7 days", H2))
    s.append(bullets([
        "1. Validation: <b>done this pass</b> — review results, then iterate toward the 70/90 target (see companion PDF).",
        "2. Voice spike on behavioural (Emmanuel) — Chrome STT → textarea behind a flag.",
        "3. Lock demo posture (Feroz) — recommend mock + Haiku; defer pgvector unless persistence is required.",
        "4. Parser robustness number — reuse the validation corpus to report the ≥95% parse metric.",
    ]))
    s.append(Spacer(1, 8))
    s.append(P("Generated from the working audit (you-are-auditing-my-snazzy-sky.md). Figures and numbers reflect the repo on 20 June 2026.", SMALL))

    doc.build(s, onFirstPage=footer, onLaterPages=footer)
    return out


# --------------------------------------------------------------------------- #
# PDF 2 — Fit-Scorer Validation Study (with figures)
# --------------------------------------------------------------------------- #
def make_embeddings_cm():
    """Generate an embeddings-arm confusion matrix PNG from results.jsonl (reuses validate_matching)."""
    sys.path.insert(0, os.path.join(REPO, "scripts", "validation"))
    import validate_matching as vm  # type: ignore

    results = os.path.join(ART, "results.jsonl")
    if not os.path.exists(results):
        return None
    rows = [json.loads(l) for l in open(results, encoding="utf-8") if l.strip()]
    labels = sorted({r["true_category"] for r in rows})
    _, _, yt, yp = vm.accuracy(rows, "embeddings")
    path = os.path.join(FIGS, "cm_embeddings.png")
    vm.plot_confusion(yt, yp, labels, path, "Confusion matrix — embeddings arm (real BGE-small)")
    return path


def build_validation_study():
    out = os.path.join(HERE, "Synthesis_Fit_Validation_Study.pdf")
    metrics = json.load(open(os.path.join(ART, "metrics.json")))
    arms = metrics["arms"]

    doc = SimpleDocTemplate(out, pagesize=letter, topMargin=0.7 * inch, bottomMargin=0.7 * inch,
                            leftMargin=0.7 * inch, rightMargin=0.7 * inch,
                            title="Synthesis — Fit-Scorer Validation Study", author="Team Cynthése")
    s = []
    s.append(P("Fit-Scorer Validation Study", H1))
    s.append(P("Deliverable #2 / Success Metric #1 &nbsp;·&nbsp; 20 June 2026 &nbsp;·&nbsp; "
               "Targets: top-1 ≥ 70%, top-3 ≥ 90%", SUB))

    s.append(P("What was measured", H2))
    s.append(P("The falsifiable proposal claim: <i>a resume scores highest against postings from its own field.</i> "
               "Each resume is scored against one synthetic requirement profile per job family (built from the LinkedIn "
               "postings corpus), then families are ranked. The harness scores with the <b>live engine</b> "
               "(it imports the real <font face='Courier'>parseResume</font> / <font face='Courier'>parseJD</font> / "
               "<font face='Courier'>scoreFit</font> / embeddings), so the number reflects the shipping product.", BODY))
    s.append(P("Corpus: 2,484 resumes → 2,362 after dropping the 3 under-populated families (BPO, AUTOMOBILE, AGRICULTURE) "
               "and corrupt rows → <b>21 families</b>. Field profiles from 48,069 postings mapped via a curated title→family map "
               "(43% title coverage).", SMALL))

    s.append(P("Result — and the headline finding", H2))
    rows = [["Arm", "top-1", "top-3", "Notes"]]
    rows.append([P("structured — full corpus (live engine)", CELL), P("12.1%", CELL), P("32.6%", CELL), P("rules + O*NET only", CELL)])
    rows.append([P("structured — subset", CELL), P(f"{arms['structured']['top1']:.1%}", CELL), P(f"{arms['structured']['top3']:.1%}", CELL), P("same 840 resumes as below", CELL)])
    rows.append([P("<b>embeddings — subset (real BGE)</b>", CELLB),
                 P(f"<b>{arms['embeddings']['top1']:.1%}</b>", CELLB), P(f"<b>{arms['embeddings']['top3']:.1%}</b>", CELLB),
                 P("nearly hits target out of the box", CELL)])
    rows.append([P("combined — subset (50/50)", CELL), P(f"{arms['combined']['top1']:.1%}", CELL), P(f"{arms['combined']['top3']:.1%}", CELL), P("naive blend; weak arm drags it down", CELL)])
    rows.append([P("<b>targets</b>", CELLB), P("<b>70%</b>", CELLB), P("<b>90%</b>", CELLB), P("", CELL)])
    s.append(table(rows, [2.3 * inch, 0.8 * inch, 0.8 * inch, 3.2 * inch]))
    s.append(P("<b>The missing half of the proposal's own methodology — \"semantic embeddings <i>plus</i> deterministic rules\" — "
               "is the half that works.</b> Real BGE-small embeddings take top-1 from ~12% to <b>66.5%</b> and top-3 to "
               "<b>87.0%</b>, within striking distance of the 70/90 targets, while the shipped rules-only engine flatlines "
               "near chance (21-class random ≈ 4.8%). The naive 50/50 blend hurts, so the blend must weight embeddings higher. "
               "Embeddings were never wired into the live fit engine — that is the top lever to clear target.", BODY))
    s.append(P("Embeddings/combined figures are a stratified 40/family subset (840 resumes); the structured full-corpus number "
               "(2,362) is shown for reference. The harness scores 100% on clean fixtures, confirming the low structured number "
               "is an engine/methodology limit, not a harness bug.", SMALL))

    s.append(P("Ablation — embeddings vs structured", H2))
    s.append(fit_image(os.path.join(ART, "accuracy_by_arm.png"), USABLE_W * 0.72))

    cm_emb = make_embeddings_cm()
    s.append(PageBreak())
    s.append(P("Confusion matrices", H2))
    s.append(P("Row-normalized (true family → predicted family). The embeddings arm has a strong diagonal; the structured arm "
               "scatters off-diagonal.", SMALL))
    if cm_emb:
        s.append(fit_image(cm_emb, USABLE_W))
        s.append(Spacer(1, 8))
    s.append(fit_image(os.path.join(ART, "confusion_matrix.png"), USABLE_W))

    s.append(PageBreak())
    s.append(P("Per-family top-1 (structured arm)", H2))
    pf = metrics["per_family_structured"]
    ordered = sorted(pf.items(), key=lambda kv: -kv[1]["top1"])
    rows = [["Family", "n", "top-1"]]
    for fam, d in ordered:
        rows.append([P(fam, CELL), P(str(d["n"]), CELL), P(f"{d['top1']:.1%}", CELL)])
    s.append(table(rows, [3.0 * inch, 0.8 * inch, 1.0 * inch]))

    s.append(P("Levers to reach target", H2))
    s.append(bullets([
        "<b>Add the embeddings arm to the live fit engine</b> (<font face='Courier'>lib/matching.ts</font>) and weight the blend toward embeddings — it nearly clears target alone.",
        "Expand the O*NET taxonomy beyond 21 occupations (the structured arm is tech/analytics-biased).",
        "Improve the postings title→family mapping coverage (currently 43%).",
    ]))

    s.append(P("Reproduce", H2))
    s.append(P("<font face='Courier'>npm run validate:prep</font> → <font face='Courier'>npm run validate:fit</font> → "
               "<font face='Courier'>npm run validate:report</font>. Real embeddings: "
               "<font face='Courier'>npm i @xenova/transformers</font> then "
               "<font face='Courier'>EMBEDDINGS_ENABLED=true npm run validate:fit -- --sample 40</font>. "
               "Smoke (no dataset): <font face='Courier'>npm run validate:smoke</font>. "
               "Harness: <font face='Courier'>scripts/validation/</font>.", SMALL))

    doc.build(s, onFirstPage=footer, onLaterPages=footer)
    return out


if __name__ == "__main__":
    if not os.path.exists(os.path.join(ART, "metrics.json")):
        sys.exit("Missing scripts/validation/.artifacts/metrics.json — run the validation harness first "
                 "(npm run validate:fit && npm run validate:report).")
    p1 = build_progress_report()
    p2 = build_validation_study()
    print("Wrote:")
    for p in (p1, p2):
        print(f"  {p}  ({os.path.getsize(p) // 1024} KB)")
