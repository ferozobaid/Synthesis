# Synthesis - Product Source of Truth

This file records current product decisions and status. Historical execution
plans are not authoritative when they conflict with this document.

## Product

Synthesis is an interview-preparation platform with three modules:

1. **Resume-to-JD Fit Analyzer** - scores one resume against one JD and returns
   an interpretable requirement-level report.
2. **Behavioural Interview Simulator** - asks JD-grounded behavioural questions
   and scores answers against a prepared STAR answer bank.
3. **Case Interview Simulator** - runs adaptive strategy and technical
   interview workflows.

Authentication, centralized persistence, and user accounts are outside the
current MVP. The future database provider is undecided.

## Fit Analyzer Decision

The production Fit Analyzer route calls `scoreFitAnalyzer()`.

- `scoreFit()` remains the deterministic structured baseline.
- Semantic requirement matching uses local BGE-small embeddings.
- The production method is `hybrid_0_25`: 25% structured and 75% semantic.
- Production hybrids directly blend raw pair-level 0-100 scores.
- If embeddings are disabled or fail, the route returns structured scoring.
- O*NET is loaded from the committed local JSON dictionary through
  `lib/onet.ts`.
- The Fit Analyzer does not use O*NET RAG, a vector database, or a centralized
  database.

The current 45/65/80 product presentation boundaries have not been calibrated
against an external population. Validation supports relative method selection,
not the absolute correctness of every score or band.

## Two Planes

### Live plane

`/app`, `/lib`, and shared components contain the product UI, API routes,
parsers, scoring, local O*NET access, embeddings, and interview workflows.

### Offline plane

`/scripts` contains dataset preparation, Fit validation, and O*NET taxonomy
maintenance. Datasets and validation artifacts are never imported by live
code.

## Fit Validation

Two active studies support the production decision.

### Scoped code validation

- 353 resumes.
- 269 parseable real JDs after a three-requirement gate.
- Consultant, Finance, and Information Technology source families.
- Large-sample occupational-family proxy task.
- Structured and semantic pair scores are averaged by JD family.
- Hybrid arms independently min-max normalize the two family-score maps before
  blending with structured weights 0.25, 0.50, and 0.75.
- The publishable run is full-sample and strict-BGE. Its manifest binds the
  sampling report, requested model revision, packaged-model files, inputs,
  implementation dependencies, and outputs by hash.
- Sampled and non-default parser-gate experiments use isolated diagnostic
  artifacts and cannot overwrite or publish as the scoped result.
- The best pre-specified family-normalized arm is structured weight 0.25, with
  top-1 accuracy of approximately 68%.

This study tests coarse family discrimination. It does not prove pair-level
score accuracy.

### 54-pair validation

- 54 unique real resume-JD pairs from the same frozen scoped artifacts.
- Five arms: structured, embedding, and hybrid structured weights 0.25, 0.50,
  and 0.75.
- Pair-level hybrids directly blend raw structured and semantic scores with no
  min-max normalization or calibration.
- Diagnostic arm labels use a three-level mapping at 45 and 65. This combines
  the product's 65-79 and 80+ presentation bands as Strong and does not validate
  the 80 cut point separately.
- Human rubric labels were completed before hidden arm outputs were merged.
- Hybrid 0.25 has the strongest Spearman correlation and pairwise ordering
  accuracy in the completed sample.

The sample is balanced by JD family and LOW/MID/HIGH selection band and is
enriched for arm disagreement. It supports arm comparison, not natural
production prevalence.

Together, the two studies support retaining `hybrid_0_25`. They do not validate
the absolute product score bands.

## Locked Decisions

| Area | Decision |
|---|---|
| Default Claude model | `claude-haiku-4-5` |
| Demo Claude model | `claude-sonnet-4-6` |
| Fit production method | Raw pair-level `hybrid_0_25` |
| Fit fallback | Structured `scoreFit()` |
| O*NET | Local committed JSON dictionary only |
| Embeddings | Local BGE-small; never a paid embedding API |
| Validation mapper | LLM posting-family mapper only |
| Database | Not part of the current MVP |
| Datasets | Offline development and validation only |

## Data Sources

| Dataset | Role |
|---|---|
| Resume Dataset | Resume text and source-family labels for validation |
| LinkedIn Job Postings | Real JD text for parser testing and validation |
| O*NET 30.3 | Source for the committed runtime taxonomy subset |

Raw resume and posting datasets remain local and gitignored. The live product
ships only the curated O*NET JSON subset.

## Documentation Authority

- `AGENTS.md`: repository build and architecture rules.
- `source-of-truth.md`: current product decisions and validation position.
- `scripts/validation/README.md`: executable Fit validation workflow.
- `scripts/validation/HUMAN_VALIDATION_PROTOCOL.md`: active 54-pair protocol.
- `reports/Synthesis_Fit_Validation_Study.pdf`: generated result snapshot.
- `Synthesis_Finish_Line_Execution_Plan.md`: historical planning record.
