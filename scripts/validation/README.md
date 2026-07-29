# Fit Analyzer Validation

This directory contains the two active offline validation workflows for the
Fit Analyzer:

1. scoped occupational-family code validation;
2. blinded 54-pair resume-to-JD validation.

Both workflows use the production `parseResume()` and `parseJD()` parsers and
the same structured and semantic scorers. They answer different questions and
aggregate scores differently.

## Scope

The current studies use three O*NET-aligned source families:

- `INFORMATION-TECHNOLOGY`
- `FINANCE`
- `CONSULTANT`

Datasets and generated artifacts are offline-only. No file under this directory
is imported by `/app` or `/lib`.

## Inputs

Required local, gitignored datasets:

```text
Datasets/archive/Resume/Resume.csv
Datasets/archive-2/postings.csv
```

The LLM mapper in `llm_family_map.py` is the only posting-family classifier. It
maps postings to the 21 retained resume families plus `UNMAPPED`; preparation
then filters to the three study families.

## Code Validation

Code validation asks whether a resume scores highest against real JDs from its
own source family. It is a large-sample occupational-family proxy, not a direct
test of whether one pair's product score is correct.

```text
prepare_data.py
  -> resumes.scoped.jsonl + jds.scoped.jsonl + sampling_report.scoped.json
score_resumes.ts
  -> results.scoped.jsonl + validation_manifest.scoped.json
validate_matching.py
  -> metrics.scoped.json + figures
```

Run:

```bash
npm run validate:prep
npm run validate:fit
npm run validate:report
npm run validate:pdf
```

`validate:prep` is cache-only by default. It reuses
`.artifacts/posting_family_map.jsonl` and does not make unexpected API calls. If
the cache cannot fill all quotas, explicitly opt in:

```bash
npm run validate:prep -- --allow-llm-calls
```

This optional step reads `OPENAI_API_KEY` from `.env.local` and remains subject
to the configured call limit.

### Code-validation scoring

For each resume:

1. score it against every retained JD;
2. average raw structured scores by JD family;
3. average raw semantic scores by JD family;
4. independently min-max normalize the structured and semantic family-score
   maps;
5. blend those normalized maps using structured weights 0.25, 0.50, and 0.75.

These arms are therefore **family-normalized proxy hybrids**. They are not the
same aggregation as the production pair-level hybrid.

The main scoped run always uses strict local BGE embeddings. It fails instead
of falling back to mock vectors. `validation_manifest.scoped.json` records the
backend, requested model revision, packaged-model file hashes, formulas, parser
gate, sampling-report hash, input hashes, output hash, Git commit, worktree
state, and hashes of the scoring implementation and dependency files.
`validate_matching.py` refuses to publish scoped semantic metrics unless that
manifest records `backend=bge`, `fallback_allowed=false`, a matching sampling
report, unchanged implementation hashes, and a full unsampled run.

The parser gate defaults to at least three extracted requirements per JD:

```bash
npm run validate:fit -- --min-jd-requirements 3
```

`--sample` and non-default parser-gate experiments are diagnostic runs. They
write isolated artifacts such as
`results.diagnostic-sample-10.jsonl` instead of overwriting
`results.scoped.jsonl`, and `validate_matching.py` will not publish them:

```bash
npm run validate:fit -- --sample 10
npm run validate:fit -- --min-jd-requirements 2
```

Primary code-validation metrics are top-1 accuracy, mean rank, MRR,
correct-family margin, per-family accuracy, and a 3x3 confusion matrix. Top-3
is not a useful headline metric for a three-family task.

## 54-Pair Validation

The pair-level workflow uses the same frozen scoped resume and JD artifacts,
but evaluates 54 unique resume-JD pairs against blinded rubric labels.

```bash
npm run validate:human54 -- --prepare
```

Review only:

```text
scripts/validation/.artifacts/human54/reviewer.csv
scripts/validation/.artifacts/human54/review_packet.md
```

Do not open `hidden_key.jsonl` until all labels have been completed. Apply and
freeze the labels, then finalize:

```bash
npm run validate:human54 -- --apply-labels scripts/validation/.artifacts/human54/labels.json
npm run validate:human54 -- --finalize
```

The five pair-level arms are:

- `structured`
- `embedding`
- `hybrid_0_25`
- `hybrid_0_5`
- `hybrid_0_75`

For each pair, hybrid arms directly blend the raw 0-100 structured and semantic
scores. No min-max normalization, score transformation, or calibration is
applied. This matches the production `scoreFitHybrid()` calculation.

Sampling uses six pairs in every JD-family by LOW/MID/HIGH cell, with four
same-source-family pairs and two cross-family stress pairs per cell. Each final
resume and JD is unique. The bands are based on the mean within-family
percentile across all five arms. Within each cell, pairs with greater arm
disagreement are selected first. This design supports method comparison; it
does not estimate natural production prevalence.

The final outputs are:

```text
human54/comparison.csv
human54/metrics.json
human54/metrics.csv
human54/manifest.json
human54/audit.json
human54/RESULTS.md
```

Threshold-based label metrics use a pre-specified three-level mapping at 45 and
65 only as diagnostics. The mapping combines the product's 65-79 and 80+
presentation bands as `STRONG`; it does not validate the 80 cut point
separately. Rank correlation and pairwise ordering are the primary pair-level
method-comparison evidence.

## Smoke And Unit Tests

The smoke workflow uses tiny local fixtures and an explicitly recorded
deterministic mock embedding backend:

```bash
npm run validate:smoke
```

It verifies workflow mechanics only and must not support a production-method
claim.

Run the Python preparation and manifest tests with:

```bash
npm run validate:test
```

Run the repository TypeScript tests and typecheck after validation changes:

```bash
npm run typecheck
npm test
```

## Artifacts

Generated material is written under `scripts/validation/.artifacts/` and is
gitignored. Cleanup code must not automatically delete local datasets, labels,
review packets, hidden keys, comparisons, metrics, manifests, or audit files.

`npm run validate:pdf` also refreshes de-identified summary metrics, manifests,
and checksums under `reports/fit-validation/`. Those committed summaries contain
no resume or JD text.
