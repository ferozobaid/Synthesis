# scripts/validation/ - Scoped real-JD fit validation

Validates the falsifiable claim that a resume scores highest against real
posting-level JDs from its own family. The current study is intentionally scoped
to the O*NET-aligned families:

- `INFORMATION-TECHNOLOGY`
- `FINANCE`
- `CONSULTANT`

The older synthetic `field_profiles.json` harness is no longer the main path.
Validation inputs now flow through the same production parsers used by the app:
`parseResume()` and `parseJD()`.

## Pipeline

| Step | File | In -> Out |
|---|---|---|
| 1. Prep | `prepare_data.py` | `Resume.csv` + `postings.csv` -> scoped resume/JD JSONL |
| 2. Map | `llm_family_map.py` | posting -> 21 retained families + `UNMAPPED` cache |
| 3. Score | `score_resumes.ts` | scoped JSONL -> structured / embedding / hybrid scores |
| 4. Report | `validate_matching.py` | results -> metrics + figures |

The LLM mapper remains 22-way (`21 families + UNMAPPED`) even though this study
filters down to three families. This keeps the cache useful for a future mapper
benchmark without making the current validation pay for every posting.

## Inputs

Required local, gitignored files:

```text
Datasets/archive/Resume/Resume.csv
Datasets/archive-2/postings.csv
```

`job_skills.csv` and `skills.csv` are not required for the scoped real-JD study
because synthetic field profiles are no longer built.

## Outputs

Derived artifacts are written under `scripts/validation/.artifacts/`:

```text
resumes.scoped.jsonl
jds.scoped.jsonl
posting_family_map.jsonl
sampling_report.json
results.scoped.jsonl
jd_parse_diagnostics.scoped.json
metrics.scoped.json
accuracy_by_arm.scoped.png
confusion_matrix.scoped.png
```

These artifacts are gitignored.

## Run

Smoke test, no OpenAI calls:

```bash
npm run validate:smoke
```

Main scoped study:

```bash
npm run validate:prep
npm run validate:fit
npm run validate:report
```

`validate:prep` reads `OPENAI_API_KEY` from `.env.local`, classifies candidate
postings into 22 labels, and stops after collecting 100 high-confidence real JDs
for each scoped family. Cached labels are reused on later runs.

Embeddings use local BGE-small through `@xenova/transformers` when
`EMBEDDINGS_ENABLED=true`; otherwise the deterministic mock embedder is used and
the embedding arm should not be interpreted as semantic.

`validate:fit` parses every selected JD before scoring and, for the main scoped
study, defaults to `--min-jd-requirements 3`. This drops postings that do not
yield enough structured requirements for `scoreFit()`/semantic matching to be a
meaningful test. Smoke mode defaults to `0` because its fixtures are tiny. The
gate can be overridden, for example:

```bash
npm run validate:fit -- --min-jd-requirements 0
```

## Metrics

Because the scoped validation has only three families, top-3 accuracy is not a
headline metric. The report focuses on:

- top-1 accuracy
- mean rank
- MRR
- correct-family margin
- 3x3 confusion matrix

The same frozen split is used for all arms:

- `structured`
- `embedding`
- `hybrid_0_25`
- `hybrid_0_5`
- `hybrid_0_75`

The hybrid suffix is the structured-score weight.

## Blinded human validation

Generate a 30-pair review sheet from the scoped artifacts (within the current
24–36 pair target):

```bash
npm run validate:human
```

For the local nine-pair pilot (no Kaggle files or API calls required):

```bash
npm run validate:human:smoke
```

Open `human_pair_review.<mode>.csv` in Excel and label every row `WEAK`,
`MEDIUM`, or `STRONG` without opening the JSONL key. Use confidence 1 (low),
2 (moderate), or 3 (high), and briefly record the strongest matching evidence
and any critical must-have gaps. After saving the CSV, analyze agreement:

Use the full rubric and evidence rules in `HUMAN_VALIDATION_PROTOCOL.md`.

```bash
npm run validate:human -- --analyze
npm run validate:human:smoke -- --analyze
```

Generate and analyze the blinded keyword-vs-LLM mapper comparison similarly:

```bash
npm run validate:human -- --mapper
npm run validate:human -- --mapper --analyze
```

The mapper sample prioritizes rows where the two methods disagree. Treat the
smoke files only as workflow verification; they are too small and synthetic to
support a production-method decision. Generated review sheets, answer keys, and
metrics are written under `scripts/validation/.artifacts/` and are gitignored.
