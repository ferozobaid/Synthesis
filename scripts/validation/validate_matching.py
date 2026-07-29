#!/usr/bin/env python3
"""
Scoped real-JD validation report - OFFLINE PLANE.

Consumes results.scoped.jsonl and reports top-1 accuracy, mean rank, MRR,
correct-family margin, and 3x3 confusion matrices for structured, embedding,
and hybrid arms. Top-3 is intentionally not a headline metric for a three-family
validation task.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import struct
import zlib
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
ART = HERE / ".artifacts"
SCOPED_FAMILIES = ["CONSULTANT", "FINANCE", "INFORMATION-TECHNOLOGY"]


def ranked(scores: dict[str, float]) -> list[str]:
    return [k for k, _ in sorted(scores.items(), key=lambda kv: (-float(kv[1]), kv[0]))]


def arm_names(row: dict[str, Any]) -> list[str]:
    skip = {"id", "true_category", "jd_counts"}
    return [k for k, v in row.items() if k not in skip and isinstance(v, dict)]


def read_jd_parse_diagnostics(smoke: bool) -> dict[str, Any] | None:
    path = ART / ("jd_parse_diagnostics.smoke.json" if smoke else "jd_parse_diagnostics.scoped.json")
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_repo_file(description: str, relative_path: Any, expected_hash: Any) -> None:
    if not isinstance(relative_path, str) or not relative_path:
        raise SystemExit(f"Validation manifest is missing {description} path.")
    if not isinstance(expected_hash, str) or not expected_hash:
        raise SystemExit(f"Validation manifest is missing {description} hash.")
    repo = REPO.resolve()
    path = (repo / relative_path).resolve()
    try:
        path.relative_to(repo)
    except ValueError as exc:
        raise SystemExit(f"Validation manifest {description} escapes the repository.") from exc
    if not path.exists():
        raise SystemExit(f"Validation manifest {description} file is missing: {path}")
    if sha256_file(path) != expected_hash:
        raise SystemExit(f"Validation manifest {description} hash does not match: {path}")


def read_validation_manifest(smoke: bool, result_path: Path) -> dict[str, Any]:
    suffix = "smoke" if smoke else "scoped"
    path = ART / f"validation_manifest.{suffix}.json"
    if not path.exists():
        raise SystemExit(
            f"Missing {path}. Re-run score_resumes.ts so the scoring backend "
            "and input hashes are recorded."
        )
    manifest = json.loads(path.read_text(encoding="utf-8"))
    expected_mode = "smoke" if smoke else "scoped-real-jd"
    if manifest.get("mode") != expected_mode:
        raise SystemExit(
            f"{path} records mode {manifest.get('mode')!r}; expected "
            f"{expected_mode!r}. Diagnostic runs cannot publish scoped metrics."
        )
    if manifest.get("diagnostic_parameters") is not None:
        raise SystemExit(f"{path} contains diagnostic parameters and cannot publish metrics.")
    embedding = manifest.get("embedding") or {}
    expected_backend = "mock" if smoke else "bge"
    if embedding.get("backend") != expected_backend:
        raise SystemExit(
            f"{path} records embedding backend {embedding.get('backend')!r}; "
            f"expected {expected_backend!r} for this validation mode."
        )
    if embedding.get("fallback_allowed") is not False:
        raise SystemExit(f"{path} must record fallback_allowed=false.")
    if not smoke:
        if not embedding.get("requested_revision"):
            raise SystemExit(f"{path} must record the requested BGE revision.")
        if embedding.get("revision_enforced_for_remote_loading") is not True:
            raise SystemExit(f"{path} must enforce the requested BGE revision.")
        if embedding.get("source") == "packaged-local":
            if not embedding.get("model_bundle_sha256"):
                raise SystemExit(f"{path} must record the packaged BGE bundle hash.")
            model_files = embedding.get("model_files_sha256") or {}
            if not model_files:
                raise SystemExit(f"{path} must record packaged BGE file hashes.")
            bundle_hash = hashlib.sha256(
                json.dumps(model_files, separators=(",", ":")).encode("utf-8")
            ).hexdigest()
            if embedding.get("model_bundle_sha256") != bundle_hash:
                raise SystemExit(f"{path} packaged BGE bundle hash is inconsistent.")
            for relative_path, expected_hash in model_files.items():
                verify_repo_file("packaged BGE model", relative_path, expected_hash)
        elif embedding.get("source") != "remote-or-cache":
            raise SystemExit(f"{path} records an unsupported BGE source.")
    recorded_hash = (manifest.get("output") or {}).get("results_sha256")
    actual_hash = sha256_file(result_path)
    if recorded_hash != actual_hash:
        raise SystemExit(
            f"{result_path} does not match the manifest hash. Re-run "
            "score_resumes.ts before generating metrics."
        )
    output = manifest.get("output") or {}
    result_rows = sum(1 for line in result_path.read_text(encoding="utf-8").splitlines() if line.strip())
    if output.get("result_rows") != result_rows:
        raise SystemExit(f"{path} result row count does not match {result_path}.")
    inputs = manifest.get("inputs") or {}
    if not smoke and inputs.get("resume_source_rows") != inputs.get("resume_rows"):
        raise SystemExit(f"{path} contains a sampled resume subset and cannot publish scoped metrics.")
    verify_repo_file("resume input", inputs.get("resumes"), inputs.get("resumes_sha256"))
    verify_repo_file("JD input", inputs.get("jds"), inputs.get("jds_sha256"))
    verify_repo_file(
        "sampling report",
        inputs.get("sampling_report"),
        inputs.get("sampling_report_sha256"),
    )
    parser_gate = manifest.get("parser_gate") or {}
    verify_repo_file(
        "JD parser diagnostics",
        parser_gate.get("diagnostics"),
        parser_gate.get("diagnostics_sha256"),
    )
    implementation_files = manifest.get("implementation_sha256") or {}
    if not implementation_files:
        raise SystemExit(f"{path} must record scoring implementation hashes.")
    for relative_path, expected_hash in implementation_files.items():
        verify_repo_file("scoring implementation", relative_path, expected_hash)
    return manifest


def metrics_for(rows: list[dict[str, Any]], arm: str, labels: list[str]) -> dict[str, Any]:
    n = max(1, len(rows))
    top1_hits = 0
    ranks: list[int] = []
    reciprocal: list[float] = []
    margins: list[float] = []
    confusion = {true: {pred: 0 for pred in labels} for true in labels}
    predictions: list[str] = []

    for row in rows:
        true = row["true_category"]
        scores = {k: float(v) for k, v in row[arm].items()}
        order = ranked(scores)
        pred = order[0]
        predictions.append(pred)
        if pred == true:
            top1_hits += 1
        rank = order.index(true) + 1 if true in order else len(order) + 1
        ranks.append(rank)
        reciprocal.append(1.0 / rank)
        wrong_scores = [score for family, score in scores.items() if family != true]
        margins.append(scores.get(true, 0.0) - max(wrong_scores or [0.0]))
        if true not in confusion:
            confusion[true] = {label: 0 for label in labels}
        if pred not in confusion[true]:
            confusion[true][pred] = 0
        confusion[true][pred] += 1

    per_family: dict[str, dict[str, Any]] = {}
    for label in labels:
        idx = [i for i, row in enumerate(rows) if row["true_category"] == label]
        hits = sum(1 for i in idx if predictions[i] == label)
        family_margins = [margins[i] for i in idx]
        per_family[label] = {
            "n": len(idx),
            "top1": round(hits / max(1, len(idx)), 4),
            "mean_margin": round(sum(family_margins) / max(1, len(family_margins)), 4),
        }

    return {
        "top1": round(top1_hits / n, 4),
        "mean_rank": round(sum(ranks) / n, 4),
        "mrr": round(sum(reciprocal) / n, 4),
        "mean_margin": round(sum(margins) / n, 4),
        "median_margin": round(sorted(margins)[len(margins) // 2], 4) if margins else 0,
        "per_family": per_family,
        "confusion_matrix": confusion,
    }


def maybe_plot(metrics: dict[str, Any], labels: list[str], best_arm: str, out_dir: Path, suffix: str) -> dict[str, str]:
    figures: dict[str, str] = {}
    try:
        with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            import matplotlib

            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
    except Exception:
        return fallback_pngs(metrics, labels, best_arm, out_dir, suffix)

    arms = list(metrics["arms"].keys())
    top1 = [metrics["arms"][arm]["top1"] for arm in arms]
    mrr = [metrics["arms"][arm]["mrr"] for arm in arms]
    x = list(range(len(arms)))

    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.bar([i - 0.18 for i in x], top1, width=0.36, label="top-1")
    ax.bar([i + 0.18 for i in x], mrr, width=0.36, label="MRR")
    ax.set_xticks(x)
    ax.set_xticklabels(arms, rotation=25, ha="right")
    ax.set_ylim(0, 1)
    ax.set_ylabel("score")
    ax.set_title("Scoped validation arms")
    ax.legend()
    fig.tight_layout()
    arms_path = out_dir / f"accuracy_by_arm.{suffix}.png"
    fig.savefig(arms_path, dpi=130)
    plt.close(fig)
    figures["accuracy_by_arm"] = str(arms_path)

    cm = metrics["arms"][best_arm]["confusion_matrix"]
    matrix = [[cm.get(true, {}).get(pred, 0) for pred in labels] for true in labels]
    row_sums = [max(1, sum(row)) for row in matrix]
    norm = [[value / row_sums[i] for value in row] for i, row in enumerate(matrix)]
    fig, ax = plt.subplots(figsize=(6.5, 5.5))
    im = ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(len(labels)))
    ax.set_yticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=35, ha="right")
    ax.set_yticklabels(labels)
    ax.set_xlabel("Predicted family")
    ax.set_ylabel("True family")
    ax.set_title(f"Confusion matrix - {best_arm}")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    fig.tight_layout()
    cm_path = out_dir / f"confusion_matrix.{suffix}.png"
    fig.savefig(cm_path, dpi=130)
    plt.close(fig)
    figures["confusion_matrix"] = str(cm_path)
    return figures


def write_png(path: Path, width: int, height: int, pixels: list[tuple[int, int, int]]) -> None:
    raw = b"".join(
        b"\x00" + b"".join(bytes(pixel) for pixel in pixels[y * width : (y + 1) * width])
        for y in range(height)
    )

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    data = b"\x89PNG\r\n\x1a\n"
    data += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(raw, 9))
    data += chunk(b"IEND", b"")
    path.write_bytes(data)


def fill_rect(
    pixels: list[tuple[int, int, int]],
    width: int,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    color: tuple[int, int, int],
) -> None:
    height = len(pixels) // width
    for y in range(max(0, y0), min(height, y1)):
        start = y * width
        for x in range(max(0, x0), min(width, x1)):
            pixels[start + x] = color


def fallback_pngs(metrics: dict[str, Any], labels: list[str], best_arm: str, out_dir: Path, suffix: str) -> dict[str, str]:
    figures: dict[str, str] = {}

    arms = list(metrics["arms"].keys())
    width, height = 720, 420
    pixels = [(255, 255, 255)] * (width * height)
    fill_rect(pixels, width, 50, 40, width - 30, height - 60, (245, 247, 250))
    group_w = max(1, (width - 120) // max(1, len(arms)))
    for i, arm in enumerate(arms):
        top1 = float(metrics["arms"][arm]["top1"])
        mrr = float(metrics["arms"][arm]["mrr"])
        base_x = 70 + i * group_w
        base_y = height - 70
        bar_max = height - 130
        fill_rect(pixels, width, base_x, base_y - int(bar_max * top1), base_x + 18, base_y, (43, 111, 194))
        fill_rect(pixels, width, base_x + 24, base_y - int(bar_max * mrr), base_x + 42, base_y, (234, 132, 44))
    arms_path = out_dir / f"accuracy_by_arm.{suffix}.png"
    write_png(arms_path, width, height, pixels)
    figures["accuracy_by_arm"] = str(arms_path)

    size = 420
    pixels = [(255, 255, 255)] * (size * size)
    cm = metrics["arms"][best_arm]["confusion_matrix"]
    matrix = [[cm.get(true, {}).get(pred, 0) for pred in labels] for true in labels]
    n = max(1, len(labels))
    cell = 300 // n
    x0, y0 = 70, 60
    for y, row in enumerate(matrix):
        denom = max(1, sum(row))
        for x, value in enumerate(row):
            rate = value / denom
            blue = 255 - int(170 * rate)
            color = (blue, min(255, blue + int(30 * (1 - rate))), 255)
            fill_rect(pixels, size, x0 + x * cell, y0 + y * cell, x0 + (x + 1) * cell - 2, y0 + (y + 1) * cell - 2, color)
    cm_path = out_dir / f"confusion_matrix.{suffix}.png"
    write_png(cm_path, size, size, pixels)
    figures["confusion_matrix"] = str(cm_path)
    return figures


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--fixtures", action="store_true", help="Alias for --smoke.")
    args = parser.parse_args()

    smoke = args.smoke or args.fixtures
    result_path = ART / ("results.smoke.jsonl" if smoke else "results.scoped.jsonl")
    if not result_path.exists():
        raise SystemExit(f"Missing {result_path}. Run score_resumes.ts first.")

    validation_manifest = read_validation_manifest(smoke, result_path)
    rows = [json.loads(line) for line in result_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows:
        raise SystemExit(f"No rows in {result_path}")

    labels = [label for label in SCOPED_FAMILIES if any(row["true_category"] == label for row in rows)]
    for row in rows:
        for label in row.get("structured", {}).keys():
            if label not in labels:
                labels.append(label)
    arms = arm_names(rows[0])
    arm_metrics = {arm: metrics_for(rows, arm, labels) for arm in arms}
    best_arm = sorted(arms, key=lambda arm: (-arm_metrics[arm]["top1"], -arm_metrics[arm]["mrr"], arm))[0]

    summary = {
        "mode": "smoke" if smoke else "scoped-real-jd",
        "n_resumes": len(rows),
        "labels": labels,
        "jd_counts": rows[0].get("jd_counts", {}),
        "jd_parse_diagnostics": read_jd_parse_diagnostics(smoke),
        "validation_manifest": validation_manifest,
        "arms": arm_metrics,
        "best_arm": best_arm,
    }
    summary["figures"] = maybe_plot(summary, labels, best_arm, ART, "smoke" if smoke else "scoped")

    out_path = ART / ("metrics.smoke.json" if smoke else "metrics.scoped.json")
    out_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"\nScoped validation report - {len(rows)} resumes, labels={len(labels)}\n")
    print(f"{'arm':<14}{'top-1':>9}{'mean rank':>12}{'MRR':>9}{'margin':>10}")
    for arm in arms:
        m = arm_metrics[arm]
        print(f"{arm:<14}{m['top1']:>9.1%}{m['mean_rank']:>12.2f}{m['mrr']:>9.3f}{m['mean_margin']:>10.2f}")
    jd_diag = summary["jd_parse_diagnostics"]
    if jd_diag:
        print(
            "\nJD parseability gate: "
            f">={jd_diag['min_jd_requirements']} requirements, "
            f"kept {jd_diag['kept']}/{jd_diag['total']} JDs"
        )
        for family, stats in jd_diag.get("families", {}).items():
            print(
                f"  {family:<22} kept={stats['kept']:>3}/{stats['total']:<3} "
                f"mean_req={stats['mean']:>5.2f} median_req={stats['median']:>4.1f} "
                f"zero={stats['zero_requirement']:>2}"
            )
    print(f"\nBest arm: {best_arm}")
    print(f"Metrics -> {out_path}")


if __name__ == "__main__":
    main()
