# scripts/validation/ — Fit-scorer validation study (Deliverable #2)

Validates the falsifiable proposal claim: **a resume scores highest against postings
from its own field.** Emits **top-1 / top-3 category-match accuracy, a confusion
matrix, and an embeddings-vs-structured ablation**. Targets: **top-1 ≥ 70%, top-3 ≥ 90%**.

This is **offline plane**, but it scores with the **live engine** — the harness imports
the real pure functions (`parseResume`, `parseJD`, `scoreFit`, `embed`/`cosine`) so the
number reflects the shipping product, not a re-implementation. (It is never imported by
the app; `tests/two-plane.test.ts`, which scans only `app/` + `lib/`, is unaffected.)

## Pipeline

| Step | File | In → Out |
|---|---|---|
| 1. Prep | `prepare_data.py` (pandas) | `Datasets/` CSVs → `.artifacts/resumes.jsonl` + committed `field_profiles.json` |
| 2. Score | `score_resumes.ts` (tsx, live engine) | artifacts → `.artifacts/results.jsonl` |
| 3. Report | `validate_matching.py` (sklearn/matplotlib) | results → console + `.artifacts/{metrics.json, confusion_matrix.png, accuracy_by_arm.png}` |

Supporting: `family_map.py` (curated posting-title → resume-family map — the auditable
crux of step 1) and `rank.ts` (pure ranking/blend helpers, unit-tested in
`tests/validation-rank.test.ts`).

## Run

```bash
# Smoke (no dataset needed — committed fixtures; emits a confusion matrix):
npm run validate:smoke

# Full study (requires the gitignored Datasets/):
npm run validate:prep      # build resumes.jsonl + field_profiles.json
npm run validate:fit       # score every resume × 21 field profiles (structured arm; ~80s)
npm run validate:report    # top-1/top-3 + confusion matrix + ablation

# Real embeddings ablation (otherwise the embeddings arm is a NON-semantic mock):
npm i @xenova/transformers
EMBEDDINGS_ENABLED=true npm run validate:fit -- --sample 40   # ≤40/family, fast on CPU
npm run validate:report
```

## Current result (structured arm, live engine, full corpus)

Structured arm on the **full corpus** (2,362 resumes), plus the **embeddings-vs-structured
ablation** on a stratified subset (40/family = 840 resumes, real BGE-small):

| arm | top-1 | top-3 |
|---|---|---|
| structured — full corpus (live engine) | 12.1% | 32.6% |
| structured — subset | 11.4% | 32.7% |
| **embeddings — subset (real BGE)** | **66.5%** | **87.0%** |
| combined — subset (50/50 blend) | 45.0% | 73.9% |
| targets | 70% | 90% |

**Headline finding:** the missing half of the proposal's *own* methodology ("semantic
embeddings **plus** deterministic rules") is the half that works. Real BGE embeddings take
top-1 from **11% → 67%** and top-3 to **87%** — within striking distance of the 70/90
targets — while the shipped **rules-only** engine flatlines near chance. The naive 50/50
`combined` blend *hurts* (the weak structured arm drags the strong embeddings arm down),
so the blend weight needs tuning toward embeddings.

Why the structured arm is so low (both consistent with the audit):
1. The live engine is a fit-*scorer* (resume vs one JD) used here as a field-*classifier*
   (resume vs 21 profiles); its O*NET vocabulary is **tech/analytics-biased** (21
   occupations / 84 skills), so non-tech families fall back to thin lexical overlap.
2. Field profiles are aggregated from noisy postings via a curated title→family map
   (43% title coverage); mapping noise caps the ceiling.

The harness scores **100% on the clean fixtures**, confirming the low structured number is
an engine/methodology limit, not a harness bug.

**Levers to reach target** (next iterations): **add the embeddings arm to the live fit
engine** (the proposal always specified it; it nearly clears target alone) and tune the
combine weight toward embeddings; secondarily, expand the O*NET taxonomy beyond 21
occupations and improve the title→family mapping coverage.

## Notes

- `.artifacts/` is gitignored (derived from the gitignored `Datasets/`). `field_profiles.json`
  and `fixtures/` **are** committed.
- `prepare_data.py` follows the EDA: drops the 3 under-populated families
  (BPO/AUTOMOBILE/AGRICULTURE) + corrupt rows → 21 families / 2,362 resumes, and
  de-duplicates posting reposts. Resume text cleaning (full-width dash, "Company Name"
  leak, ALL-CAPS title leak) is applied by the live `parseResume`.
