#!/usr/bin/env python3
"""
Fit-scorer validation report — OFFLINE PLANE (Deliverable #2 / Success Metric #1).

Consumes score_resumes.ts output (results.jsonl) and emits the proposal's measured
result: top-1 / top-3 category-match accuracy, a confusion matrix, and the
embeddings-vs-structured ablation. Targets: top-1 ≥ 70%, top-3 ≥ 90%.

Arms:
  - structured : the live deterministic engine (lib/matching.ts).
  - embeddings : BGE-small cosine (mock vector unless EMBEDDINGS_ENABLED was set
                 during scoring — the report flags which).
  - combined   : per-resume min-max blend of the two (mirrors rank.ts `combine`).

Run:  python3 scripts/validation/validate_matching.py
      python3 scripts/validation/validate_matching.py --fixtures
"""

from __future__ import annotations

import argparse
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from sklearn.metrics import confusion_matrix  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, ".artifacts")

TOP1_TARGET = 0.70
TOP3_TARGET = 0.90


def minmax(d: dict[str, float]) -> dict[str, float]:
    vals = list(d.values())
    lo, hi = min(vals), max(vals)
    span = hi - lo
    return {k: (0.5 if span == 0 else (v - lo) / span) for k, v in d.items()}


def combine(a: dict[str, float], b: dict[str, float], wa: float = 0.5) -> dict[str, float]:
    na, nb = minmax(a), minmax(b)
    keys = set(na) | set(nb)
    return {k: wa * na.get(k, 0.0) + (1 - wa) * nb.get(k, 0.0) for k in keys}


def ranked(d: dict[str, float]) -> list[str]:
    """Families high→low, ties broken by name (matches rank.ts rankDesc)."""
    return [k for k, _ in sorted(d.items(), key=lambda kv: (-kv[1], kv[0]))]


def accuracy(rows: list[dict], arm: str) -> tuple[float, float, list[str], list[str]]:
    top1_hits = top3_hits = 0
    y_true: list[str] = []
    y_pred: list[str] = []
    for r in rows:
        scores = r[arm] if arm in ("structured", "embeddings") else combine(
            r["structured"], r["embeddings"]
        )
        order = ranked(scores)
        true = r["true_category"]
        y_true.append(true)
        y_pred.append(order[0])
        if order[0] == true:
            top1_hits += 1
        if true in order[:3]:
            top3_hits += 1
    n = max(1, len(rows))
    return top1_hits / n, top3_hits / n, y_true, y_pred


def plot_confusion(y_true, y_pred, labels, path: str, title: str) -> None:
    cm = confusion_matrix(y_true, y_pred, labels=labels)
    cm_norm = cm / np.clip(cm.sum(axis=1, keepdims=True), 1, None)
    fig, ax = plt.subplots(figsize=(11, 9))
    im = ax.imshow(cm_norm, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(len(labels)))
    ax.set_yticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=90, fontsize=7)
    ax.set_yticklabels(labels, fontsize=7)
    ax.set_xlabel("Predicted family")
    ax.set_ylabel("True family")
    ax.set_title(title)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04, label="row-normalized rate")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def plot_arms(metrics: dict, path: str) -> None:
    arms = list(metrics.keys())
    top1 = [metrics[a]["top1"] for a in arms]
    top3 = [metrics[a]["top3"] for a in arms]
    x = np.arange(len(arms))
    w = 0.35
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.bar(x - w / 2, top1, w, label="top-1")
    ax.bar(x + w / 2, top3, w, label="top-3")
    ax.axhline(TOP1_TARGET, ls="--", lw=1, color="tab:blue", alpha=0.6)
    ax.axhline(TOP3_TARGET, ls="--", lw=1, color="tab:orange", alpha=0.6)
    ax.set_xticks(x)
    ax.set_xticklabels(arms)
    ax.set_ylim(0, 1)
    ax.set_ylabel("accuracy")
    ax.set_title("Fit-scorer ablation — embeddings vs structured")
    ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", action="store_true")
    args = ap.parse_args()

    results = os.path.join(ART, "results.fixtures.jsonl" if args.fixtures else "results.jsonl")
    if not os.path.exists(results):
        raise SystemExit(
            f"Missing {results}. Run score_resumes.ts"
            + (" --fixtures" if args.fixtures else "") + " first."
        )

    rows = [json.loads(l) for l in open(results, encoding="utf-8") if l.strip()]
    labels = sorted({r["true_category"] for r in rows})

    metrics: dict[str, dict] = {}
    structured_pred = None
    for arm in ("structured", "embeddings", "combined"):
        t1, t3, y_true, y_pred = accuracy(rows, arm)
        metrics[arm] = {"top1": round(t1, 4), "top3": round(t3, 4)}
        if arm == "structured":
            structured_pred = (y_true, y_pred)

    # Figures.
    cm_path = os.path.join(ART, "confusion_matrix.png")
    arms_path = os.path.join(ART, "accuracy_by_arm.png")
    plot_confusion(*structured_pred, labels, cm_path, "Confusion matrix — structured (live engine)")
    plot_arms(metrics, arms_path)

    # Per-family top-1 (structured) — where the engine works vs not.
    y_true, y_pred = structured_pred
    per_family: dict[str, dict] = {}
    for lab in labels:
        idx = [i for i, t in enumerate(y_true) if t == lab]
        hits = sum(1 for i in idx if y_pred[i] == lab)
        per_family[lab] = {"n": len(idx), "top1": round(hits / max(1, len(idx)), 3)}

    summary = {
        "n_resumes": len(rows),
        "n_families": len(labels),
        "targets": {"top1": TOP1_TARGET, "top3": TOP3_TARGET},
        "arms": metrics,
        "structured_pass": {
            "top1": metrics["structured"]["top1"] >= TOP1_TARGET,
            "top3": metrics["structured"]["top3"] >= TOP3_TARGET,
        },
        "per_family_structured": per_family,
        "figures": {"confusion_matrix": cm_path, "accuracy_by_arm": arms_path},
    }
    with open(os.path.join(ART, "metrics.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    # Console report.
    print(f"\nFit-scorer validation — {len(rows)} resumes, {len(labels)} families\n")
    print(f"{'arm':<12}{'top-1':>9}{'top-3':>9}")
    for arm, m in metrics.items():
        print(f"{arm:<12}{m['top1']:>9.1%}{m['top3']:>9.1%}")
    print(f"\ntargets      {TOP1_TARGET:>9.0%}{TOP3_TARGET:>9.0%}")
    s = metrics["structured"]
    print(
        f"\nstructured (live engine) vs target: "
        f"top-1 {'PASS' if s['top1'] >= TOP1_TARGET else 'BELOW'} "
        f"({s['top1']:.1%}), "
        f"top-3 {'PASS' if s['top3'] >= TOP3_TARGET else 'BELOW'} ({s['top3']:.1%})"
    )
    best = sorted(per_family.items(), key=lambda kv: -kv[1]["top1"])
    print("\ntop-1 by family (structured), best → worst:")
    for fam, d in best:
        print(f"  {d['top1']:>6.1%}  {fam:<24} (n={d['n']})")
    print(f"\nFigures + metrics.json → {ART}")


if __name__ == "__main__":
    main()
