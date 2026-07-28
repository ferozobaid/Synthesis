# Synthesis Human Validation Report

**Date:** July 28, 2026  
**Reviewer:** Ibukunoluwa  
**Scope:** Fit Analyzer pair-level validation and role-family validation

## Executive summary

This study compared independent human judgments with five Synthesis Fit Analyzer
validation arms on 36 synthetic resume-job-description pairs spanning
Information Technology, Finance, and Consulting. The human reviewer labelled 15
pairs Weak, 8 Medium, and 13 Strong using a four-dimension rubric. Against the
primary 0-8 human total, Hybrid 0.25 (25% structured rules and 75% semantic
matching) achieved the strongest rank alignment, with Spearman's rho of 0.800.

The role-family mapper check covered the 12 unique job descriptions in the
pair-level package. The LLM and keyword mappers agreed on all 12 JDs. Each mapper
achieved 10 of 12 accuracy (83.3%) against the initial frozen human labels and
11 of 12 (91.7%) against the adjudicated labels. The remaining difference was
Technology Consultant, which the reviewer classified as Information Technology
while both mappers classified it as Consulting. This is a defensible boundary
case between technical delivery and advisory work.

The results support Hybrid 0.25 as the strongest of the five evaluated arms on
this sample, but they do not establish universal production thresholds. The
semantic-heavy arms produced compressed scores that overlapped across human fit
categories, particularly for Medium cases.

## 1. Objectives

The validation addressed two separate questions:

1. Do Structured, semantic-only, and Hybrid 0.25, 0.50, and 0.75 Fit Analyzer
   scores rank resume-JD pairs consistently with the 0-8 human rubric totals and
   the resulting Weak, Medium, and Strong judgments?
2. Do human reviewers agree with the intended Information Technology, Finance,
   and Consulting role-family classifications?

The role-family analysis is separate from fit scoring. Hybrid 0.25 estimates
the fit between a specific resume and JD; it does not itself assign a role
family.

## 2. Data and methodology

### 2.1 Pair-level sample

The pair-level package contained 36 synthetic resume-JD pairs:

- 12 Information Technology pairs
- 12 Finance pairs
- 12 Consulting pairs
- 12 cross-family mismatches
- 12 low, 12 medium, and 12 high analyzer-score sampling bands

The sample was synthetic and contained no private candidate information. The
reviewer completed the blinded worksheet without consulting analyzer scores,
expected categories, score bands, or answer-key metadata.

### 2.2 Human fit rubric

Each pair received a score from 0 to 2 on four dimensions:

| Dimension | Score range |
|---|---:|
| Core skills | 0-2 |
| Experience and domain | 0-2 |
| Seniority and years | 0-2 |
| Education and hard constraints | 0-2 |

The four scores produced a total from 0 to 8:

- 0-3: Weak
- 4-6: Medium
- 7-8: Strong

Only evidence explicitly present in the resume and JD was considered. Missing
gating requirements, central tools, direct domain experience, and role-relevant
seniority reduced the relevant dimension scores.

### 2.3 System methods

Five system outputs were compared on the same frozen pairs:

- **Structured:** deterministic rules-only scoring.
- **Embedding-only:** semantic requirement matching using the
  repository-pinned BGE-small-en-v1.5 embedding model.
- **Hybrid 0.25:** 25% structured and 75% semantic.
- **Hybrid 0.50:** 50% structured and 50% semantic.
- **Hybrid 0.75:** 75% structured and 25% semantic.

Semantic and hybrid scores were generated only after the human ratings had been
completed and frozen. They were written to a separate generated-artifact
directory so the human worksheet was not overwritten. The pair-level hybrids
blend raw pair scores; this is distinct from the original family-level proxy,
which min-max normalized family-average scores before blending.

### 2.4 Evaluation measures

The comparison examined:

- Human-label distribution
- Spearman rank correlation between the 0-8 human total and system scores
- Secondary Spearman correlation using ordinal fit categories
- Mean and range of system scores by human category
- Pairwise ordering accuracy by human total and category
- Descriptive in-sample threshold accuracy
- Largest human-system disagreements
- Human-versus-LLM and human-versus-keyword role-family accuracy
- LLM-versus-keyword role-family agreement

## 3. Human fit results

### 3.1 Label distribution

| Human label | Count | Share |
|---|---:|---:|
| Weak | 15 | 41.7% |
| Medium | 8 | 22.2% |
| Strong | 13 | 36.1% |
| **Total** | **36** | **100.0%** |

All 36 rows contained valid 0-2 dimension scores. All totals and category
mappings were internally consistent, and no duplicate pair identifiers were
present.

### 3.2 Agreement with synthetic calibration metadata

The human categories agreed with the package's synthetic expected categories
for 29 of 36 pairs (80.6%). This is a rubric-calibration result, not Fit Analyzer
accuracy: the expected categories were hand-authored metadata attached to the
synthetic strong, partial, and cross-family resume templates.

The seven human-versus-expected-category differences were HFV-005, HFV-006,
HFV-007, HFV-013, HFV-016, HFV-017, and HFV-022. They primarily reflected
different interpretations of partial technical evidence, transferable
experience, relevant seniority, related education, and supporting experience
versus direct ownership.

## 4. Five-arm scoring comparison

### 4.1 Rank alignment

| Method | Spearman vs. human total | Spearman vs. category |
|---|---:|---:|
| Rules-only structured | 0.764 | 0.725 |
| Embedding-only semantic | 0.761 | 0.662 |
| **Hybrid 0.25 rules / 0.75 semantic** | **0.800** | 0.737 |
| Hybrid 0.50 rules / 0.50 semantic | 0.784 | **0.738** |
| Hybrid 0.75 rules / 0.25 semantic | 0.777 | 0.734 |

All five methods showed positive alignment with the human ratings. Hybrid 0.25
was the strongest against the primary 0-8 human total. Hybrid 0.50 was narrowly
highest against the coarser three-category labels, but the difference from
Hybrid 0.25 was 0.001 and does not outweigh Hybrid 0.25's stronger total-score
correlation.

### 4.2 Scores by human category

| Method | Weak mean | Medium mean | Strong mean |
|---|---:|---:|---:|
| Rules-only structured | 53.40 | 64.13 | 82.23 |
| Embedding-only semantic | 79.53 | 80.75 | 82.38 |
| **Hybrid 0.25** | **73.33** | **76.88** | **82.38** |
| Hybrid 0.50 | 66.60 | 72.63 | 82.69 |
| Hybrid 0.75 | 60.20 | 68.38 | 82.38 |

All arms produced monotonically increasing mean scores from Weak to Medium to
Strong. Embedding-only scoring compressed the three means into a 2.85-point
range. Adding structured weight increased separation, while Hybrid 0.25 retained
enough semantic influence to produce the strongest rank correlation with the
human total.

### 4.3 Pairwise ordering

Pairwise accuracy asks whether the method gives the higher score to the pair
with the higher human total or category. The table gives half credit to system
score ties.

| Method | By human total | By human category |
|---|---:|---:|
| Rules-only structured | 82.0% | 85.2% |
| Embedding-only semantic | 82.3% | 82.1% |
| **Hybrid 0.25** | **84.6%** | **86.6%** |
| Hybrid 0.50 | 83.4% | 86.4% |
| Hybrid 0.75 | 83.0% | 85.8% |

Hybrid 0.25 was strongest on both pairwise measures. This supports the same
conclusion as the primary Spearman comparison.

### 4.4 Descriptive category thresholds

Thresholds optimized on these same 36 observations produced the following
descriptive results:

| Method | In-sample thresholds | Correct | Accuracy |
|---|---|---:|---:|
| Rules-only structured | Weak <=63; Medium 64-66; Strong >=67 | 27/36 | 75.0% |
| Embedding-only semantic | Weak <=79; Medium 80; Strong >=81 | 24/36 | 66.7% |
| **Hybrid 0.25** | Weak <=77; Medium 78; Strong >=79 | **28/36** | **77.8%** |
| Hybrid 0.50 | Weak <=72; Medium 73-74; Strong >=75 | 27/36 | 75.0% |
| Hybrid 0.75 | Weak <=68; Medium 69-70; Strong >=71 | 27/36 | 75.0% |

The Hybrid 0.25 confusion counts under these descriptive thresholds were:

| Human category | Predicted Weak | Predicted Medium | Predicted Strong |
|---|---:|---:|---:|
| Weak | 13 | 0 | 2 |
| Medium | 3 | 2 | 3 |
| Strong | 0 | 0 | 13 |

Hybrid 0.25 separated Strong cases well in this sample but classified only 2 of
8 Medium cases as Medium. The single-point Medium interval is evidence of weak
three-category calibration and must not be used as a production threshold.

### 4.5 Main Hybrid 0.25 disagreements

The highest-scoring human-Weak cases were:

| Pair | Human label | Structured score | Hybrid score |
|---|---|---:|---:|
| HFV-007 | Weak | 82 | 83 |
| HFV-015 | Weak | 71 | 79 |
| HFV-024 | Weak | 63 | 77 |
| HFV-035 | Weak | 69 | 77 |
| HFV-006 | Weak | 61 | 77 |

These cases suggest that semantic similarity can reward related language and
partial evidence even when the human reviewer identifies a missing gating
requirement, insufficient ownership, or inadequate role-relevant seniority.
This supports retaining a structured component and presenting the resulting
score as an advisory fit signal rather than a hiring certification.

## 5. Role-family mapper validation

### 5.1 Methods

The 12 unique job descriptions were classified by three sources:

- **Frozen human:** the reviewer's initial blind category.
- **LLM mapper:** `gpt-4o-mini` using the repository's 22-way role-family prompt,
  temperature 0, and the complete JD text.
- **Keyword mapper:** the repository's deterministic, ordered title-keyword
  rules.

The frozen human labels are the primary reference. Investment Analyst was later
adjudicated from Consulting to Finance, so adjudicated-human accuracy is
reported separately as a sensitivity analysis. LLM-versus-keyword is an
agreement measure rather than accuracy because neither method is human ground
truth.

### 5.2 Per-JD comparison

| JD | Frozen human | Adjudicated human | LLM | Keyword |
|---|---|---|---|---|
| Backend Software Engineer | Information Technology | Information Technology | Information Technology | Information Technology |
| Cloud DevOps Engineer | Information Technology | Information Technology | Information Technology | Information Technology |
| Data Engineer | Information Technology | Information Technology | Information Technology | Information Technology |
| Finance Manager | Finance | Finance | Finance | Finance |
| Financial Analyst | Finance | Finance | Finance | Finance |
| FP&A Analyst | Finance | Finance | Finance | Finance |
| Frontend Engineer | Information Technology | Information Technology | Information Technology | Information Technology |
| Investment Analyst | **Consulting** | Finance | Finance | Finance |
| Management Consultant | Consulting | Consulting | Consulting | Consulting |
| Operations Consultant | Consulting | Consulting | Consulting | Consulting |
| Strategy Consultant | Consulting | Consulting | Consulting | Consulting |
| Technology Consultant | **Information Technology** | Information Technology | Consulting | Consulting |

### 5.3 Accuracy and agreement

| Comparison | Primary/sensitivity status | Result |
|---|---|---:|
| Frozen human vs. LLM | Primary accuracy | 10/12 (83.3%) |
| Frozen human vs. keyword | Primary accuracy | 10/12 (83.3%) |
| LLM vs. keyword | Method agreement | 12/12 (100.0%) |
| Adjudicated human vs. LLM | Sensitivity accuracy | 11/12 (91.7%) |
| Adjudicated human vs. keyword | Sensitivity accuracy | 11/12 (91.7%) |

The two mapper methods produced identical classifications for this small,
synthetic sample. Their two primary disagreements with the frozen human review
were Investment Analyst and Technology Consultant.

### 5.4 Adjudication and remaining boundary case

Investment Analyst was initially classified as Consulting and was subsequently
adjudicated as Finance after reviewing its financial-modeling, valuation,
portfolio-analysis, and investment-analysis responsibilities. This change is
not included in the primary blind accuracy; it appears only in the adjudicated
sensitivity result.

The sole remaining difference was Technology Consultant:

- **Human classification:** Information Technology
- **LLM and keyword classification:** Consulting

The human classification prioritized cloud implementation, SQL, Python, and AWS
requirements. The automated classifications prioritized technology advisory,
implementation planning, project management, and stakeholder management. The
case demonstrates legitimate ambiguity when a role combines technical delivery
with consulting responsibilities. A production taxonomy should either document
a primary-function tie-break rule or support a secondary family label for such
hybrid roles.

## 6. Limitations

- The 36 resume-JD pairs and 12 unique JDs are synthetic.
- Only Information Technology, Finance, and Consulting were represented.
- One primary reviewer completed the assessments; inter-rater reliability was
  not measured.
- The expected fit categories were design metadata, not independent expert
  judgments.
- Narrative reviewer notes were not collected for every pair, limiting the
  qualitative audit trail.
- Hybrid scores were compressed and thresholds were optimized on the evaluation
  sample itself.
- No held-out sample was used to test threshold generalization.
- The role-family mapper result uses only 12 synthetic JDs and should not be
  generalized to the full 22-family taxonomy or to candidate-job fit quality.
- The LLM mapper was run once at temperature 0; repeated-run stability was not
  measured.

## 7. Conclusions and recommendations

Hybrid 0.25 was the best-performing of the five arms on this scoped pair-level
study. It had the highest Spearman correlation with the 0-8 human total, the
highest pairwise ordering accuracy, and the highest descriptive category
accuracy. Hybrid 0.50 was narrowly highest on category-only Spearman correlation,
but Hybrid 0.25 provided the strongest overall evidence. The semantic-heavy
scores nevertheless remained compressed, and every arm showed weak
discrimination of Medium cases.

The role-family mapper study achieved 83.3% primary accuracy for both LLM and
keyword methods against frozen human labels, with 100% agreement between the two
automated methods. Adjudicated-human accuracy was 91.7%. The Technology
Consultant boundary case indicates that technically intensive advisory roles
cannot always be represented cleanly by a single family.

Recommended next steps are:

1. Preserve Hybrid 0.25 as the production candidate, with structured fallback
   and transparent method reporting.
2. Do not adopt the in-sample 77/78 Hybrid thresholds as production cutoffs.
3. Validate category thresholds on a new held-out sample with multiple human
   reviewers.
4. Add second-reviewer adjudication for ambiguous fit and role-family cases.
5. Treat gating requirements and direct ownership evidence explicitly so
   semantic similarity cannot dominate critical gaps.
6. Permit secondary role-family labels or document a primary-function tie-break
   rule for hybrid roles such as Technology Consultant.
7. Present Fit Analyzer outputs as calibrated decision support rather than
   definitive candidate certification.

## 8. Reproducibility record

- Human ratings: `scripts/validation/human_fit_validation/reviewer_sheet.csv`
- Structured answer key: `scripts/validation/human_fit_validation/answer_key.csv`
- Hybrid pair comparison:
  `scripts/validation/.artifacts/hybrid_human_comparison.csv`
- Reproducible five-arm evaluator:
  `scripts/validation/evaluate_human_fit_arms.ts`
- Five-arm per-pair scores:
  `reports/validation_evidence/human_fit_five_arm_scores.csv`
- Five-arm metrics:
  `reports/validation_evidence/human_fit_five_arm_metrics.json`
- Role-family review:
  `scripts/validation/.artifacts/human_role_family_review.csv`
- Role-family reference key:
  `scripts/validation/.artifacts/human_role_family_key.csv`
- Preserved frozen and adjudicated role labels:
  `scripts/validation/human_fit_validation/role_family_frozen_labels.csv`
- Reproducible role-mapper evaluator:
  `scripts/validation/evaluate_role_family_mappers.ts`
- Three-way role comparison:
  `reports/validation_evidence/role_family_three_way_comparison.csv`
- Role-mapper metrics:
  `reports/validation_evidence/role_family_three_way_metrics.json`
- Hybrid model: `Xenova/bge-small-en-v1.5`
- Hybrid weighting: 25% structured rules and 75% semantic matching
