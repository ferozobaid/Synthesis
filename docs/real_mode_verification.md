# Real-Mode Verification — Claude Haiku

Verifying that all three Synthesis modules run end-to-end against the **live Anthropic
API on Haiku** (`claude-haiku-4-5`), without changing the team's default mock-mode setup,
and measuring token usage / rough cost.

| | |
|---|---|
| **Date** | 2026-06-15 |
| **Branch** | `feroz/real-mode-verification` |
| **Model** | `claude-haiku-4-5` (locked default; `temperature: 0`) — **Sonnet not used** |
| **Mode under test** | Real, via `SYNTHESIS_USE_MOCKS=false`; embeddings + Supabase stay in-process |
| **Status** | **Live Haiku run complete (2026-06-16).** All 3 modules exercised against `claude-haiku-4-5`. Fit ✓ · Behavioural ⚠ partial · Case ⚠ per-turn fallback (final score genuine). **Finding:** the live integration works, but per-turn/per-answer evaluators **silently fall back to the heuristic on substantive answers** (output hits `max_tokens` → truncated JSON) — see **Findings** below. |

> **Live-run values are now filled in** from `live-verification-output.txt` (functional results)
> and `live-usage-lines.txt` (token counts). The Cost section now reports **measured** numbers.
> Headline result: real mode reaches Haiku, but most per-turn/per-answer eval calls truncate at
> `max_tokens` and **silently fall back to the heuristic** — see **Findings**.

---

## Safety / credentials confirmation

- **`.env.local` is gitignored** — `.gitignore:17-18` (`.env.local`, `.env*.local`). Only `.env.local.template` is committed. ✓
- **API key read from environment only** — `lib/claude.ts:25` constructs `new Anthropic()`, which reads `ANTHROPIC_API_KEY` from the env. The key is **never hardcoded** and **never committed**. ✓
- **No key is required to produce this report** or the harness; the live run uses your local key only. ✓
- `ANTHROPIC_API_KEY` is **never set in any `/scripts` file** (offline plane untouched). ✓

---

## How real mode is enabled (without changing the team default)

`useMocks()` (`lib/config.ts:28`) returns mocks unless **both** `ANTHROPIC_API_KEY` and
Supabase are set, **or** `SYNTHESIS_USE_MOCKS` is set explicitly. Because we are **not**
using Supabase, real mode is forced with `SYNTHESIS_USE_MOCKS=false`. RAG/embeddings gate
on `embeddingsEnabled()` (not `useMocks()`), so leaving `EMBEDDINGS_ENABLED` unset keeps
retrieval and embeddings fully in-process — **only `complete()` hits the network.**

```bash
# MOCK baseline (team default — nothing changes):
npm run dev

# REAL (Haiku) — for the verification run only; inline env leaves nothing on disk:
SYNTHESIS_USE_MOCKS=false  ANTHROPIC_API_KEY=sk-ant-...  SYNTHESIS_LOG_USAGE=true \
  npm run dev   2>server.log
```

The default `useMocks()` behaviour for the team is **never modified**. `.env.local`
(gitignored) is the alternative to inline env vars.

### How to run the verification

```bash
# 1. Launch the dev server in one terminal using one of the commands above.
# 2. In another terminal, drive all three modules:
node verify/real-mode.mjs
#    (BASE_URL=... to point elsewhere; MODULES=fit,case to run a subset.)
# 3. In REAL mode, read token counts from the server log:
grep '\[synthesis usage\]' server.log
```

Run the driver **once in mock mode** and **once in real mode** to populate the mock-vs-real
comparison below.

---

## Where the real model path actually runs

| Module | Route | Claude call sites | Claude calls / session |
|---|---|---|---|
| **1. Fit Analyzer** | `app/api/fit/analyze/route.ts` | **none** — deterministic O*NET pipeline (`lib/matching.ts`) | **0** |
| **2. Behavioural** | `app/api/behavioural/route.ts` | `evaluateBehavioural` → `complete()` (`lib/behavioural/evaluator.ts:387`) | **1 per answered question** |
| **3. Case** | `app/api/case/route.ts` | `evaluateResponse` per turn (`lib/fsm/case-evaluator.ts:304`) **+** `scoreCase` final (`lib/fsm/case-scoring.ts:276`) | **(turns) + 1** |

> **Key finding:** the **Fit Analyzer has no Claude path at all** — parsing + matching are
> pure functions, so its output is byte-identical in mock and real mode and it costs **$0**.
> "Real-mode model verification" is therefore **N/A** for Module 1; we still verify it runs
> and that the `mock` flag flips. The two modules that exercise Haiku are Behavioural and Case.

Every real call goes through `complete()` + `extractJSON()` and is wrapped in `try/catch`
that falls back to the deterministic heuristic on any error.

---

## Module-by-module results

### Module 1 — Fit Analyzer
| Field | Value |
|---|---|
| Uses `complete()` | **No** (deterministic) |
| `extractJSON` parses to expected shape | N/A (no model output) |
| Fallback heuristic triggered | **N/A** (no fallback path exists) |
| Output shape matches `FitReport` | **PASS** — `overall_score` 0-100, classified `per_requirement`, gaps/keywords/recs |
| Mock vs real | **Identical** except the `mock` flag (verify by diffing the driver's `fingerprint` across a mock run and a real run) |
| Coherence spot-check | **PASS** — REAL mode (`mock=false`); `overall_score` **36/100** (identical to mock); JD parsed Revature / Oracle FinTech Consultant; 3 gaps + 3 recommendations. 0 Claude calls, no fallback, **$0**. |
| Cost | **$0** |

### Module 2 — Behavioural Simulator
| Field | Value |
|---|---|
| **Pass / fail** | **⚠ PARTIAL** — integration verified, but 2 of 3 answers fell back |
| Uses `complete()` | **Yes** — 1 billed call per answered question (3/3 logged) |
| `extractJSON` parses to `BehaviouralScore` | **Yes when output fits the cap** (`why_this_role`, 791 out). **Truncated** on the 2 rich answers (`out=900` cap) → parse failed → fallback |
| Fallback heuristic triggered | **YES — 2 of 3** (`leadership`, `data_driven_decision`). Cause: `max_tokens=900` truncation, **not** a schema mismatch. `why_this_role` used the real path |
| Output shape | **Confirmed** `BehaviouralScore` (dimension_scores 1-5, overall, strengths, improvements). Real `why_this_role` returned **5 dims incl. a `Key-point coverage`** Haiku did *not* omit despite no matched answer (mock correctly drops it) |
| Coherence spot-check | overall **4.1/5**; per-answer 4.6 / 4.8 / 3.0. Plausible — but 4.6 & 4.8 are **heuristic-fallback** values; **3.0 (`why_this_role`) is the genuine Haiku score** |
| Driver inputs | questions `leadership`, `data_driven_decision`, `why_this_role`; JD = `context/jd_samples/consultant.txt`. RAG matched prepared answers at 0.70 / 0.704; none for `why_this_role` |

### Module 3 — Case Simulator
| Field | Value |
|---|---|
| **Pass / fail** | **⚠ ISSUE** — all 9 per-turn evals fell back; only the **final score** is genuine Haiku |
| Uses `complete()` | **Yes** — 9 per-turn evals **+** 1 final (10 billed calls logged) |
| `extractJSON` parses to `Evaluation` / `CaseScore` | Per-turn: **failed** (all 9 at `out=900` cap → truncated → fallback). Final: **parsed** (`out=1152 < 1200`) → real `CaseScore` |
| Fallback heuristic triggered | **YES — all 9 per-turn evals** (scores byte-identical to mock). **Final holistic score used the real path** |
| Output shape | **Confirmed** `Evaluation` / `CaseScore`. Final score carries **model-written** strengths/`next_focus` (a paragraph proposing a "70/30 split on incremental online sales") |
| Coherence spot-check | FSM advanced cleanly (**9 turns + 1**); final **5/5** with rich, transcript-citing feedback. But per-turn scores are the **heuristic** (== mock), so live per-turn evaluation isn't actually being exercised |
| Driver inputs | case `beautify`, strong per-stage answers grounded in the rubric/target elements |

### Detecting a fallback (corrected by the live run)

A fallback returns **heuristic-shaped output silently** (the evaluator's `try/catch` swallows it).
**A `[synthesis usage]` line does NOT prove "no fallback"** — `complete()` logs usage *before*
`extractJSON` runs, so a fallback caused by truncated/invalid JSON still shows a usage line (this
is exactly what happened here). The reliable tells are:
1. **Scores byte-identical to the deterministic heuristic** for that input (compare against a mock run), **and**
2. **`output_tokens` at the `max_tokens` cap** (900 / 1200) → the JSON was truncated.

**If a fallback triggers:** determine why (here: truncation — `extractJSON` couldn't parse the cut-off JSON).
- Fix **only** if it's a small prompt-wording / `max_tokens` / `extractJSON` robustness issue → **this case** (raise `maxTokens` or tighten the prompt; see Findings).
- **Stop and report** if it's a structural schema mismatch — **not** the case here.

---

## Findings — live run

### F1 (blocking for real-mode scoring): eval calls truncate at `max_tokens` → silent heuristic fallback

**What happens.** On substantive answers, Haiku's eval JSON plus its verbose justifications exceed
the eval call's `max_tokens` (900 for per-turn/per-answer evals; 1200 for the final score). The
response is cut off mid-JSON, `extractJSON`/`JSON.parse` throws, and the evaluator's `try/catch`
returns the deterministic `heuristicEvaluation`. The fallback is **silent** — no error surfaced.

**Evidence.**
- All **9** case per-turn scores and **2 of 3** behavioural scores are **byte-identical to the
  mock heuristic**, and every one of those calls shows **`output_tokens` = the cap (900)**. Haiku
  independently matching a keyword heuristic on 45+ dimension scores is implausible → they fell back.
- The only substantive calls that **diverge** from mock — behavioural `why_this_role` (`out=791`)
  and the case **final score** (`out=1152`) — are the only ones that **finished under the cap**, and
  they carry unmistakably model-written content (`why_this_role` has an extra `Key-point coverage`
  dim; the final `next_focus` proposes a "70/30 split on incremental online sales").

**Root cause:** `max_tokens` too low for the eval prompts — **not** a schema mismatch.

**Recommended fix (NOT applied in this commit — needs its own billed re-verify):**
- Raise `maxTokens` on the eval calls to ~1800–2000 — `lib/fsm/case-evaluator.ts:304` (900),
  `lib/behavioural/evaluator.ts:387` (900), `lib/fsm/case-scoring.ts:276` (1200 → ~2000); **and/or**
- Tighten the eval prompts to demand terser JSON (shorter justifications, drop `transcript_evidence`)
  so output stays under the cap.
- Then re-run `verify/real-mode.mjs` in real mode and confirm per-turn scores **differ** from mock
  and `output_tokens` sits below the cap.

### F2 (minor): Haiku didn't omit `Key-point coverage` when no prepared answer matched

Real `why_this_role` returned a `Key-point coverage=3` dimension despite no retrieved prepared
answer; the prompt asks the model to omit it, and mock mode drops it deterministically. Low impact
(it nudged the behavioural average). If it matters, strengthen the omit instruction or filter the
dimension in `coerceScore` when `prepared === null`. **Not changed in this commit.**

---

## Token usage (measured — from the `SYNTHESIS_LOG_USAGE` log)

`complete()` emits one line per real call (gated on `SYNTHESIS_LOG_USAGE=true`):
`[synthesis usage] model=claude-haiku-4-5 input_tokens=… output_tokens=…`. Numbers below are a
representative complete run. **`output_tokens` is pinned at the cap on every substantive call**
(only `why_this_role` 791 and the final 1152 finished under) — the truncation behind the F1 fallback.

| Call | maxTokens | input_tokens | output_tokens |
|---|---|---|---|
| Behavioural — `leadership` | 900 | 800 | **900 (capped)** |
| Behavioural — `data_driven_decision` | 900 | 697 | **900 (capped)** |
| Behavioural — `why_this_role` | 900 | 498 | 791 |
| Case — per-turn eval (×9) | 900 | 643–793 (~725) | **900 (capped)** each |
| Case — final score | 1200 | 2,739 | 1,152–1,200 |
| **Behavioural session** (3 answers) | — | 1,995 | 2,591 |
| **Case session** (9 turns + 1 = 10 calls) | — | 9,264 | 9,300 |

---

## Measured cost

**Haiku 4.5 pricing (authoritative):** **$1.00 / 1M input**, **$5.00 / 1M output** (200K context).
→ `cost = input_tokens × $1e-6 + output_tokens × $5e-6`. Computed from the measured tokens above.
**These costs are billed even when the call falls back** — you pay for the truncated output *and*
get the heuristic result.

| Unit | input | output | cost |
|---|---|---|---|
| Behavioural — per answer | ~665 avg | 791–900 | **~$0.005** ($0.0045–0.0053) |
| Case — per-turn eval | ~725 avg | 900 | **~$0.0052** |
| Case — final score | 2,739 | ~1,200 | **~$0.0087** |
| **Fit session** | 0 | 0 | **$0** |
| **Behavioural session** (3 answers) | 1,995 | 2,591 | **~$0.015** |
| **Case session** (9 turns + 1) | 9,264 | 9,300 | **~$0.056** |

> **Verified (mock-mode choreography, this session):** a clean strong-answer case run =
> **9 candidate turns + 1 final = 10 calls** (`data_reveal` drips 2 exhibits, so it takes
> ~3 turns). Weak answers add probe/redirect/hint turns — the FSM caps at 2 probes + a
> graduated hint ladder, then force-advances — which raises the call count and cost.

### Under a $10 budget (measured)

| Module | Cost / session | Sessions per $10 |
|---|---|---|
| Fit | $0 | **unlimited** (no model call) |
| Behavioural | ~$0.015 | **~670** (~2,000 individual answers @ ~$0.005) |
| Case | ~$0.056 | **~180** |

**Is the Case simulator disproportionately expensive? Yes — even more than estimated.** It is the
only module that makes **N + 1** calls (one per candidate turn plus a large full-transcript final
score), versus Behavioural's **N** and Fit's **0**. Measured, a full case ≈ **3.7×** a 3-answer
behavioural session and ∞× Fit — higher than the earlier ~3× estimate because every per-turn eval
emits the full 900-token output cap. Weak answers add probe/redirect turns, pushing it higher.
Cost levers: cap turns, trim the final-scoring transcript, or aggregate per-turn evaluations instead
of a separate final call. (Note: raising `maxTokens` to fix the F1 truncation would *increase*
per-call output cost; tightening the eval prompt would lower it.)

---

## Mock vs real comparison

The comparison itself **exposes the F1 fallback**: wherever real == mock exactly, the real call
truncated and fell back; where they diverge, the real Haiku path actually ran.

| Module | Mock | Real (measured) | Delta |
|---|---|---|---|
| Fit | O*NET score 36/100 | **36/100, identical** | only the `mock` flag flips (deterministic; no model call) |
| Behavioural | STAR heuristic | mixed | `leadership` 4.6 & `data_driven` 4.8 **identical to mock** (fell back); `why_this_role` **3.0 vs mock 2.5** with an extra `Key-point coverage` dim → **genuine Haiku** |
| Case | feature heuristic + aggregation | mixed | all 9 per-turn evals **identical to mock** (fell back); **final score diverges** — model-written feedback + `hypothesis=5` → **genuine Haiku** |

Mock and real are **shape-compatible by construction** — the evaluators short-circuit on
`useMocks()` and the real path coerces Haiku's JSON into the same types — so the UI is unaffected
in either mode (and, currently, even when the real call falls back).

---

## Changes

- **This update is report-only** — no source files changed. (The prior session added the opt-in
  usage log in `lib/claude.ts` and the `verify/real-mode.mjs` driver; both unchanged here.)
- **Recommended but NOT applied** (see Findings F1): raise the evaluators' `maxTokens`
  (`lib/fsm/case-evaluator.ts`, `lib/fsm/case-scoring.ts`, `lib/behavioural/evaluator.ts`) or tighten
  the eval prompts, then re-verify. This needs its own billed run, so it's left as a follow-up.
- No rubric, schema (`lib/types.ts`), or module-structure changes. `npm test`, `tsc`, `npm run build` pass.

---

## Recommendation — demo mode

- **Fix F1 first** for a *genuine* Haiku demo: as-is, the per-turn/per-answer evaluators silently
  fall back to the heuristic on substantive answers, so "real" and mock produce nearly identical
  per-turn scores. The case **final score** and lighter behavioural answers already exercise Haiku.
- **Fit Analyzer:** always live — deterministic and **free** (no model call) in any mode.
- **Behavioural & Case:** once F1 is fixed, demo on **Haiku** — measured cost is low (~**$0.015**
  per behavioural session, ~**$0.056** per case session). Keep **mock mode** as the zero-dependency
  fallback for offline/no-key demos; the output shape is identical, so the UI is unaffected either way.
- **Sonnet:** reserve strictly for a **final showcase** (`SYNTHESIS_MODEL_MODE=demo`) — **not** used
  in this verification (Haiku is the locked default).
- Net: **fix F1 → Haiku for the working live demo, mock as the safety net, Sonnet only for the
  final set-piece.**
