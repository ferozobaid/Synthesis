# Fit Analyzer Human-Validation Package

## Purpose

This offline package supports blind human review of synthetic JD/resume pairs for
the Synthesis Fit Analyzer. It is designed for pair-level validation, not model
tuning. The reviewer-facing sheet hides analyzer method, analyzer score,
expected category, sampled score band, and answer-key metadata.

## Files

- `reviewer_sheet.csv` - blind review sheet with JD/resume text and empty rubric fields.
- `answer_key.csv` - analyzer outputs, score-band metadata, expected rubric, and evidence.
- `pairs.json` - machine-readable copy of the same pair package.
- `manifest.json` - counts, score ranges, and regeneration metadata.
- `methodology.md` - this note.

## Sample Design

- Total pairs: 36
- Role families: IT, Finance, and Consulting.
- Synthetic source only: no private, real, or scraped candidate information.
- Cross-family mismatches: 12
- Analyzer methods observed in this artifact: structured
- Analyzer score range in this artifact: 31-89

The sampled score bands are rank-stratified terciles within this generated
package: the lowest third is `low`, the middle third is `medium`, and the
highest third is `high`. These are sampling bands, not universal score
thresholds.

## Human Rubric

Review each pair without consulting the answer key.

| Dimension | Score |
|---|---|
| Core skills | 0-2 |
| Experience/domain | 0-2 |
| Seniority/years | 0-2 |
| Education/hard constraints | 0-2 |

Map the human total to categories:

- Weak: 0-3
- Medium: 4-6
- Strong: 7-8

## Regeneration

Default deterministic regeneration uses the structured fallback path for
reproducibility and avoids depending on a local BGE model cache:

```bash
env TMPDIR=/private/tmp EMBEDDINGS_ENABLED=false npm exec -- tsx scripts/validation/generate_human_fit_package.ts
```

Optional output directory override:

```bash
env TMPDIR=/private/tmp EMBEDDINGS_ENABLED=false npm exec -- tsx scripts/validation/generate_human_fit_package.ts --out-dir scripts/validation/human_fit_validation
```

Recommended checks after regeneration:

```bash
npm run validate:smoke
npm run typecheck
npm test
```

## Known Limitations

- The pairs are synthetic and intentionally scoped to IT, Finance, and Consulting.
- The reviewer sample is small and should support directional claims only.
- The score bands are within-sample terciles, not product-level thresholds.
- The default command disables embeddings for deterministic offline regeneration;
  answer-key method values record the actual analyzer mode used.
- The expected rubric values are calibration metadata, not a substitute for blind
  human review.
- Do not tune Fit Analyzer weights on this package.
