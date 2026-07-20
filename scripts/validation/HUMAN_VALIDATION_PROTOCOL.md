# Human Validation Protocol

This protocol covers two distinct blinded checks. Do not open the generated
`*_key.*` files until all human labels have been saved.

## A. Resume-to-JD pair assessment

Review only evidence explicitly present in the resume and JD. Do not infer
skills, experience, education, or seniority that are not written down.

- **STRONG:** The resume clearly meets most important must-haves, includes
  relevant evidence, and has no critical gap that would normally prevent
  consideration.
- **MEDIUM:** The resume meets some important requirements or has credible
  transferable experience, but has at least one meaningful gap or weakly
  evidenced must-have.
- **WEAK:** The resume targets a substantially different role or misses several
  important must-haves, including any clear gating requirement.

Apply these calibration rules when the label is not obvious:

- Treat a JD requirement as **gating** when the role clearly depends on a
  specific degree, certification, work authorization, domain, tool, or technical
  stack. Missing a gating requirement should usually prevent a STRONG label
  unless the resume shows direct equivalent experience.
- Treat transferable experience as evidence for MEDIUM when the resume shows
  adjacent work, similar responsibilities, or credible learning readiness but
  does not directly show the JD's central tools, domain, or tasks.
- Use STRONG for transferable cases only when the resume shows direct evidence
  of doing the same kind of work at a comparable level, even if the exact job
  title or employer domain differs.
- Do not let soft skills alone outweigh missing role-specific requirements.
  Communication, teamwork, stakeholder management, and problem solving can
  strengthen a label, but they should not convert a role mismatch into STRONG.
- For software, data, analytics, or technical roles, missing the main named
  tools or methods should be recorded as a critical gap. Examples include no
  SQL/Python/R for a data role, no PHP/JavaScript/MySQL for a web-development
  role, or no Oracle/financial-technology evidence for a role centered on those
  systems.

Use `human_confidence_1_to_3` as follows: 1 = uncertain, 2 = reasonably sure,
3 = clear judgment. In `key_matching_evidence`, cite the most relevant resume
evidence. In `critical_gaps`, identify the most decision-relevant missing
requirement. Complete every row before analyzing results.

Use confidence 1 as a review flag, especially when the label is STRONG or WEAK.
It means the final report should avoid treating that row as decisive evidence by
itself.

The analysis compares the ordinal human labels against structured, semantic,
hybrid, and currently deployed scores using rank correlation and mean score by
label. A production-method change requires the full scoped study, a reasonable
spread of all three labels, and a consistent improvement--not the smoke pilot.

## B. Mapper comparison

Classify each posting by its primary job function, not the employer's industry
and not a single incidental keyword. Choose exactly one value from the allowed
family list; use `UNMAPPED` when none is a defensible fit.

The review CSV hides both mapper outputs. The analysis uses the human family as
the reference and reports keyword and LLM accuracy, plus which mapper wins on
their disagreements. Because disagreement rows are intentionally prioritized,
report disagreement-focused accuracy separately and do not present it as an
unbiased estimate of all postings.

## Minimum evidence standard

- Pilot: all 9 local pairs and all 3 local mapper rows; workflow check only.
- Main pair study: 24-36 blinded pairs, with representation across all three fit
  bands where the sampled evidence supports that distribution.
- Mapper check: 20-30 postings, prioritizing disagreements but retaining some
  agreement rows as controls.
- Preserve the review CSVs, key JSONL files, metrics JSON, date, and reviewer
  name together for an auditable record.
