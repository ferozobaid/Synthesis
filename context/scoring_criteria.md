# Scoring Criteria — Synthesis

The reference spec for what a strong answer looks like in the two interview modules.
It drives (a) the scoring prompts sent to Claude, and (b) human spot-checks used to keep
LLM scoring honest. Scores are **rubric-anchored and evidence-grounded** — never free-form
model opinion. Default scoring model: `claude-haiku-4-5`, low temperature.

---

## Behavioural — what a strong STAR answer looks like

A strong behavioural answer is **specific, owned, structured, and quantified**, and it
**covers the candidate's own intended key points** (retrieved from their answer bank via RAG).

**STAR completeness**
- **Situation** — concrete context (who/where/when), briefly set.
- **Task** — the candidate's specific responsibility or goal (not the team's in general).
- **Action** — what *they* did, in the first person ("I…"), with enough specificity to be credible.
- **Result** — a concrete outcome, ideally **quantified** ("reduced reporting time by ~6 hrs/week", "62% of at-risk accounts"), plus a takeaway/learning where relevant.

**Quality markers**
- Ownership: "I" not "we" for the candidate's own actions.
- Specificity over generality; real numbers and named methods.
- Relevance: the story actually answers the competency asked.
- Conciseness: tells the story in ~60–90 seconds; no rambling.

### Behavioural scoring dimensions (1–5 each)
| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| **STAR structure** | Missing ≥2 STAR elements | All four present but uneven | Clean, complete S-T-A-R |
| **Specificity / evidence** | Vague, generic | Some concrete detail | Rich, credible specifics |
| **Ownership** | "We" throughout; unclear role | Mixed | Clear personal contribution |
| **Impact / result** | No outcome | Qualitative outcome only | Quantified, meaningful result |
| **Key-point coverage** | Misses the candidate's prepared points | Covers some | Covers the candidate's own intended key points (RAG-matched) |

**Grounding:** the candidate's attempt is compared against **their own prepared answer**
for that question (top match retrieved from the per-user answer bank). The score reflects
both intrinsic STAR quality *and* how well the attempt covers the key points the candidate
themselves planned — not an external "ideal" answer. Communication can be added as a 6th
dimension for voice answers (pace, filler, clarity).

---

## Case — what a strong conclusion looks like

A strong case performance is **structured, hypothesis-driven, numerate, and synthesized**,
and the final recommendation is **answer-first and actionable**.

**A strong final recommendation**
- **Leads with the answer** (a clear yes/no/what), then the 2–3 supporting reasons.
- Is **anchored in the analysis** — cites the quant result and the key exhibit insight
  (e.g. "~1.28-year payback" + "virtual try-on drives the most value"; or "~546M pesos saved"
  + "start in the highest-readiness region").
- **Addresses risks** and how to mitigate them.
- Ends with **concrete next steps** (a pilot, a sequence, a 90-day move).

### Case scoring dimensions (1–5 each)
| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| **Structure** | No framework | Reasonable but generic/overlapping | Tailored, MECE |
| **Hypothesis** | Purely reactive | Implicit, weakly tested | Explicit, refined as data arrives |
| **Quant** | Wrong / not attempted | Right approach, slips or thin narration | Correct and clearly talked through |
| **Synthesis** | Data left unconnected | Partial; recommendation under-supported | Crisp recommendation backed by math + exhibit insight |
| **Communication** | Hard to follow | Clear but buries the answer | Answer-first, signposted, executive-ready |

**Grounding:** scored against the case's `scoring_rubric` anchors and `target_solution_notes`
(in `/context/cases/*.json`), plus the FSM transcript (which exhibits were revealed, how many
probes/hints were needed). The graduated-hint and probe counts feed the structure/quant scores —
needing the level-3 hint to reach the payback should cap the quant dimension.

---

## Anti-gaming / honesty notes
- Low temperature; fixed rubric; retrieved exemplars; periodic human spot-checks.
- The validation harness validates the **matching engine**, not the absolute correctness of any
  single score — no ground-truth "fit score" or "answer score" exists. State this in the write-up.
