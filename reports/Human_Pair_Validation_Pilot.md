# Human Pair-Level Fit Validation - Pilot Report

## Review criteria

**STRONG:** The resume clearly meets most important must-haves, provides relevant
evidence, and has no critical gap that would normally prevent consideration.

**MEDIUM:** The resume meets some important requirements or shows credible
transferable experience, but has at least one meaningful gap or weakly evidenced
must-have.

**WEAK:** The resume targets a substantially different role, misses several
important must-haves, or lacks a clear gating requirement such as a required
degree, certification, or work authorization.

**Calibration rules**

- Treat a requirement as gating when the role clearly depends on a specific
  degree, certification, work authorization, domain, tool, or technical stack.
  Missing a gating requirement should usually prevent a Strong label unless the
  resume shows direct equivalent experience.
- Transferable experience can support a Medium label when the resume shows
  adjacent work, similar responsibilities, or credible learning readiness, but
  does not directly show the JD's central tools, domain, or tasks.
- Use Strong for transferable cases only when the resume shows direct evidence
  of doing the same kind of work at a comparable level, even if the exact title
  or employer domain differs.
- Soft skills such as communication, teamwork, stakeholder management, and
  problem solving can strengthen a label, but should not outweigh missing core
  role requirements by themselves.
- For software, data, analytics, or technical roles, missing the main named
  tools or methods should be recorded as a critical gap.

**Confidence**

- **1:** Uncertain; the JD or resume is ambiguous, or the label depends heavily
  on judgment. Treat confidence 1 as a review flag.
- **2:** Reasonably confident; some judgment is required.
- **3:** Highly confident; the evidence clearly supports the label.

## Purpose and method

This pilot tested whether Synthesis Fit Analyzer scores align with independent
manual judgments on specific resume-JD pairs. The reviewer labelled nine blinded
pairs before seeing any system score or source-family label. Each pair received
an ordinal fit label, confidence rating, matching evidence, and critical-gap
note.

The pilot used the three development resumes and three development JDs already
stored under `context/resume_samples/` and `context/jd_samples/`. The nine rows
are the complete 3 x 3 cross-product. This is a workflow and rubric pilot, not a
representative accuracy study.

## Human-label results

| Label | Count | Share |
|---|---:|---:|
| Weak | 5 | 55.6% |
| Medium | 2 | 22.2% |
| Strong | 2 | 22.2% |
| **Total** | **9** | **100.0%** |

Confidence was low for five pairs, moderate for three, and high for one. This
distribution shows substantial uncertainty and reinforces the pilot-only status
of the findings.

## Pair-level audit

| Pair | Human label | Confidence | Structured score | Main matching evidence | Main gap |
|---|---|---:|---:|---|---|
| PAIR-001 | Weak | 2 | 8 | Problem solving, stakeholder coordination, and vendor supervision | No stated Oracle or financial-technology experience |
| PAIR-002 | Weak | 1 | 57 | None judged sufficiently relevant | No technology experience |
| PAIR-003 | Weak | 1 | 27 | Quantified business outcomes, systems research, and stakeholder communication | HR-focused rather than technology/data-focused |
| PAIR-004 | Medium | 2 | 29 | MBA Finance plus communication, consulting, training, project management, and process improvement | No stated Oracle or financial-technology experience |
| PAIR-005 | Weak | 1 | 57 | Communication, critical thinking, and interpersonal skills | No PHP, OOP, JavaScript, CSS, MySQL, debugging, e-commerce, or software-development evidence |
| PAIR-006 | Strong | 1 | 29 | Accounting degree, finance background, and business-risk/process analysis | No stated Oracle or financial-technology experience; reviewer judged transition plausible |
| PAIR-007 | Weak | 1 | 39 | Finance/audit analysis, modeling, Excel, Access, reporting, and stakeholder communication | No SQL, Python, R, statistics, visualization, or complex data-modeling evidence |
| PAIR-008 | Medium | 2 | 38 | Large-scale data storage, high-performance computing, analytical improvement, and technical stakeholder work | No SQL, Python, R, statistics, visualization, or formal data-modeling evidence |
| PAIR-009 | Strong | 3 | 6 | Extensive transferable technical troubleshooting, systems work, self-direction, and collaboration | No direct PHP, OOP, JavaScript, CSS, MySQL, e-commerce, or web-development evidence |

## System-alignment result

Only structured scoring was available in this run because embeddings were
disabled. The production response therefore also used structured fallback.
Semantic and `hybrid_0_25` results were not produced and must not be represented
as zero scores.

| Available method | Pairs | Spearman rank correlation with human labels |
|---|---:|---:|
| Structured scoring | 9 | -0.428 |
| Production response (structured fallback) | 9 | -0.428 |
| Semantic scoring | 0 | Not available |
| Hybrid 0.25 | 0 | Not available |

Mean structured scores moved in the opposite direction from the human labels:
37.6 for Weak, 33.5 for Medium, and 17.5 for Strong. In this pilot, the
structured score therefore did not reproduce the reviewer's ordinal judgments.

The most visible disagreements were PAIR-002 and PAIR-005, which received system
scores of 57 but human Weak labels, and PAIR-009, which received a system score
of 6 but a human Strong label. These examples suggest that the structured method
and reviewer treated transferable evidence and missing role-specific tools very
differently.

## Interpretation

This pilot identifies a potential alignment problem, but it does not establish
that another scoring method is better. The sample contains only three resumes
and three JDs, several judgments have low confidence, and no semantic or hybrid
scores were available for comparison. The results must not trigger a production
method change.

The Strong ratings for PAIR-006 and PAIR-009 also show why the refined rubric is
needed. PAIR-006 was Strong with low confidence, while PAIR-009 was Strong with
high confidence despite a stated gap in the JD's core programming stack. Under
the refined rubric, those rows should be treated as calibration examples: a
Strong label needs direct evidence for the role's central work, while confidence
1 labels should be reviewed before being used as decisive evidence.

## Recommended next steps

1. Re-score the frozen pairs with real semantic embeddings enabled so
   structured, semantic, and `hybrid_0_25` can be compared on identical pairs.
2. Run the main blinded study on 24-36 real resume-JD pairs, following the
   current execution plan, with a broader range of roles and evidence quality.
3. Add a second reviewer to a subset and report inter-rater agreement before
   making a production scoring decision.
4. Preserve the completed review CSV, hidden score key, metrics JSON, reviewer,
   and date as the audit trail.

## Conclusion

The nine-pair pilot successfully exercised the blinded human-validation
workflow. The available structured score showed negative rank alignment with
the human labels, but the sample size, confidence distribution, rubric
ambiguity, and absence of semantic/hybrid scores prevent any defensible model
change. The appropriate outcome is to use the refined rubric and proceed to the
full pair-level study.
