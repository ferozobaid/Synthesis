# 54-Pair Fit Validation Protocol

This protocol covers the active blinded resume-to-JD pair study. Review only
the generated `reviewer.csv` or `review_packet.md`. Do not open the hidden key
until every rubric judgment has been completed and frozen.

## Evidence Rules

Use only evidence explicitly present in the resume and JD. Do not infer skills,
experience, education, seniority, credentials, or authorization that are not
written down.

- **STRONG:** The resume clearly meets most important requirements, includes
  direct relevant evidence, and has no material gating gap.
- **MEDIUM:** The resume meets some important requirements or shows credible
  transferable experience, but has a meaningful gap or weakly evidenced
  must-have.
- **WEAK:** The resume targets a substantially different role or misses several
  important requirements.

Additional rules:

- Treat a requirement as gating when the role clearly depends on a specific
  degree, certification, work authorization, domain, tool, or technical stack.
- Transferable experience can support MEDIUM when the resume shows adjacent
  work or similar responsibilities without direct evidence of the JD's central
  tools, domain, or tasks.
- Use STRONG for transferable cases only when the resume shows direct evidence
  of comparable work at a comparable level.
- Do not let soft skills outweigh missing role-specific requirements.
- Missing the central tools or methods for a technical role must materially
  reduce the rubric score.

## Frozen Rubric

Score each dimension from 0 to 2:

- `core_requirements_0_to_2`: coverage of the JD's important requirements.
- `evidence_quality_0_to_2`: directness and specificity of resume evidence.
- `seniority_scope_0_to_2`: comparability of responsibility and complexity.
- `gating_requirements_0_to_2`: whether material gating requirements are met.

Sum the four dimensions into `human_total_0_to_8`.

- Total 0-2: `WEAK`
- Total 3-5: `MEDIUM`
- Total 6-8: `STRONG`
- A zero on `gating_requirements_0_to_2` caps the label at `MEDIUM`.

## Study Design

- Exactly 54 analyzable pairs.
- Three JD families: Consultant, Finance, and Information Technology.
- Six pairs per JD-family by LOW/MID/HIGH selection-band cell.
- Four same-source-family and two cross-family pairs per cell.
- Every final resume and JD is unique.
- One blinded review session.
- Five hidden scoring arms: structured, embedding, hybrid 0.25, hybrid 0.50,
  and hybrid 0.75.
- Strict local BGE embeddings with no fallback.

The selection bands are terciles of the mean within-JD-family percentile rank
across all five arm scores. Within each cell, the selection prioritizes pairs
with greater disagreement across arms. The design supports method comparison
and does not estimate natural production prevalence.

## Pair-Level Scoring

The structured and semantic arms each produce a raw 0-100 score for one
resume-JD pair. Each hybrid arm directly blends those raw pair scores:

```text
hybrid = structured_weight * structured
       + (1 - structured_weight) * semantic
```

No min-max normalization, score transformation, or calibration is applied.

The pre-specified three-level validation mapping translates arm scores into
diagnostic labels:

- score below 45: `WEAK`
- score from 45 through 64: `MEDIUM`
- score 65 or above: `STRONG`

This mapping uses the product's 45 and 65 cut points but combines the product's
65-79 and 80+ presentation bands as `STRONG`; it does not test the 80 cut point
separately. The mapping was recorded before unblinding and was not tuned to the
study. Threshold-based label metrics are secondary to rank correlation and
pairwise ordering because the five arms occupy different raw score ranges.

## Workflow

Prepare the blinded sample and hidden scores:

```bash
npm run validate:human54 -- --prepare
```

Complete all rubric judgments without opening `hidden_key.jsonl`. Store the
judgments as a JSON array, then apply and freeze them:

```bash
npm run validate:human54 -- --apply-labels scripts/validation/.artifacts/human54/labels.json
```

After the freeze record exists, merge the hidden scores and calculate metrics:

```bash
npm run validate:human54 -- --finalize
```

The final comparison file is:

```text
scripts/validation/.artifacts/human54/comparison.csv
```

Preserve the reviewer file, completed review, label source, hidden key, freeze
record, comparison, metrics, manifest, and audit together. All raw study
artifacts remain offline and gitignored.
