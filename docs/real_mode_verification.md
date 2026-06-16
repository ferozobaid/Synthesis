# Real-Mode Verification — Claude Haiku

Verifying that all three Synthesis modules run end-to-end against the **live Anthropic
API on Haiku** (`claude-haiku-4-5`), without changing the team's default mock-mode setup,
and measuring token usage / rough cost.

| | |
|---|---|
| **Date** | 2026-06-15 (scaffold) · 2026-06-16 (live run + post-fix rerun) |
| **Branch** | `feroz/real-mode-verification` |
| **Model** | `claude-haiku-4-5` (locked default; `temperature: 0`) — **Sonnet not used** |
| **Mode under test** | Real, via `SYNTHESIS_USE_MOCKS=false`; embeddings + Supabase stay in-process |
| **Status** | **✅ Verified after fix (rerun 2026-06-16).** The `max_tokens` truncation bug from the first run is **resolved** (commit `d0b53f2`): eval output now completes well under the 2000 cap and per-turn/per-answer scores are genuine Haiku. **Fit ✓ · Behavioural ✓ · Case ✓ · no fallback.** See **Findings**. |

> **Values reflect the post-fix rerun** (after `d0b53f2`), from `live-verification-output.txt`
> (functional results) and `live-usage-lines.txt` (token counts); the Cost section is **measured**.
> Headline: the earlier silent-fallback issue (eval output truncating at `max_tokens`) is **fixed** —
> all per-turn/per-answer calls now complete and return genuine Haiku scores. See **Findings**.

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
| **Pass / fail** | **✅ PASS** — all 3 answers return genuine Haiku scores; no fallback |
| Uses `complete()` | **Yes** — 1 billed call per answered question (3/3 logged) |
| `extractJSON` parses to `BehaviouralScore` | **Yes, all 3** — outputs 722–995 tokens, all under the 2000 cap → valid JSON, no truncation |
| Fallback heuristic triggered | **NO** (post-fix). Scores now differ from the mock heuristic; pre-fix, 2 of 3 fell back on the 900 cap (see Findings F1) |
| Output shape | **Confirmed** `BehaviouralScore` (dimension_scores 1-5, overall, strengths, improvements). `why_this_role` still carries a `Key-point coverage` dim despite no matched answer (see F2) |
| Coherence spot-check | overall **4.3/5** — `leadership` **5/5**, `data_driven_decision` **5/5**, `why_this_role` **3/5** (lower, as expected for a non-STAR motivation answer); feedback references the answer |
| Driver inputs | questions `leadership`, `data_driven_decision`, `why_this_role`; JD = `context/jd_samples/consultant.txt`. RAG matched prepared answers at 0.70 / 0.704; none for `why_this_role` |

### Module 3 — Case Simulator
| Field | Value |
|---|---|
| **Pass / fail** | **✅ PASS** — all 9 per-turn evals **and** the final score are genuine Haiku; no fallback |
| Uses `complete()` | **Yes** — 9 per-turn evals **+** 1 final (10 billed calls logged) |
| `extractJSON` parses to `Evaluation` / `CaseScore` | **Yes, all 10** — per-turn outputs 914–1,317 and final 929, all under the 2000 cap → valid JSON |
| Fallback heuristic triggered | **NO** (post-fix). Per-turn scores now diverge from the mock heuristic (e.g. `intro` `2,1,1,1,4` vs mock `3,1,1,2,3`); pre-fix all 9 fell back (Findings F1) |
| Output shape | **Confirmed** `Evaluation` (per turn) / `CaseScore` (final — model-written feedback: 6 strengths, 0 improvements) |
| Coherence spot-check | FSM advanced cleanly (**9 turns + 1**, no probes/hints); per-turn overalls 2→5 track answer quality; final **5/5**. Genuine model scoring throughout |
| Driver inputs | case `beautify`, strong per-stage answers grounded in the rubric/target elements |

### Detecting a fallback (method, validated by both runs)

A fallback returns **heuristic-shaped output silently** (the evaluator's `try/catch` swallows it).
**A `[synthesis usage]` line does NOT prove "no fallback"** — `complete()` logs usage *before*
`extractJSON` runs, so a fallback caused by truncated/invalid JSON still shows a usage line (this is
what the first run hit). The reliable tells are:
1. **Scores byte-identical to the deterministic heuristic** for that input (compare against a mock run), **and**
2. **`output_tokens` at the `max_tokens` cap** → the JSON was truncated.

Both tells were present in the first run and **absent in the post-fix rerun** (scores diverge from
mock; output sits well below the 2000 cap) — confirming the fix.

**If a fallback triggers:** determine why. Fix if it's a small prompt-wording / `max_tokens` /
`extractJSON` robustness issue (this was a `max_tokens` truncation — fixed). **Stop and report** if
it's a structural schema mismatch (was **not** the case).

---

## Findings — live run

### F1 — eval calls truncated at `max_tokens` → silent heuristic fallback &nbsp; ✅ RESOLVED (commit `d0b53f2`)

**What happened (first run).** On substantive answers, Haiku's eval JSON plus its justifications
exceeded the eval call's `max_tokens` (900 per-turn/per-answer; 1200 final). The response was cut off
mid-JSON, `extractJSON`/`JSON.parse` threw, and the evaluator's `try/catch` returned the deterministic
`heuristicEvaluation` — **silently**. Evidence: all 9 case per-turn scores and 2 of 3 behavioural
scores were byte-identical to the mock heuristic, each with `output_tokens` = the 900 cap; only the
calls that finished under the cap (`why_this_role`, the final score) diverged from mock.

**Root cause:** `max_tokens` too low for the eval prompts — **not** a schema mismatch.

**Fix applied (`d0b53f2`).**
- Raised `maxTokens` — `lib/behavioural/evaluator.ts` 900→2000, `lib/fsm/case-evaluator.ts` 900→2000,
  `lib/fsm/case-scoring.ts` 1200→2000.
- Strengthened the JSON instruction in all three system prompts: *"Return compact valid JSON only,
  with no prose outside the JSON."*

**Post-fix rerun confirms resolution.**
- **No call hits the cap** — outputs span **722–1,317 tokens**, all comfortably under 2,000.
- **Per-turn/per-answer scores now diverge from the mock heuristic** (e.g. case `intro` `2,1,1,1,4`
  vs mock `3,1,1,2,3`; `leadership` 5/5 with `Ownership=5` vs the heuristic's `4`) → genuine Haiku.
- No fallback observed on any of the 13 calls.

### F2 (minor, still open) — Haiku doesn't omit `Key-point coverage` when no prepared answer matched

`why_this_role` (no retrieved prepared answer) still returns a `Key-point coverage=3` dimension in the
post-fix run; the prompt asks the model to omit it, and mock mode drops it deterministically. Low
impact (nudges the behavioural average). If it matters, strengthen the omit instruction or filter the
dimension in `coerceScore` when `prepared === null`. **Not addressed by the `max_tokens` fix; left as
a minor follow-up.**

---

## Token usage (measured — post-fix rerun)

`complete()` emits one line per real call (gated on `SYNTHESIS_LOG_USAGE=true`):
`[synthesis usage] model=claude-haiku-4-5 input_tokens=… output_tokens=…`. Numbers below are the
post-fix rerun. **`output_tokens` now completes naturally — 722–1,317, none at the 2,000 cap** (the
truncation behind the old F1 fallback is gone).

| Call | maxTokens | input_tokens | output_tokens |
|---|---|---|---|
| Behavioural — `leadership` | 2000 | 809 | 995 |
| Behavioural — `data_driven_decision` | 2000 | 706 | 898 |
| Behavioural — `why_this_role` | 2000 | 507 | 722 |
| Case — per-turn eval (×9) | 2000 | 652–802 (~734) | 914–1,317 (~1,099) |
| Case — final score | 2000 | 2,748 | 929 |
| **Behavioural session** (3 answers) | — | 2,022 | 2,615 |
| **Case session** (9 turns + 1 = 10 calls) | — | 9,354 | 10,819 |

---

## Measured cost

**Haiku 4.5 pricing (authoritative):** **$1.00 / 1M input**, **$5.00 / 1M output** (200K context).
→ `cost = input_tokens × $1e-6 + output_tokens × $5e-6`. Computed from the post-fix tokens above.

| Unit | input | output | cost |
|---|---|---|---|
| Behavioural — per answer | ~674 avg | 722–995 | **~$0.005** ($0.0041–0.0058) |
| Case — per-turn eval | ~734 avg | ~1,099 | **~$0.0062** |
| Case — final score | 2,748 | 929 | **~$0.0074** |
| **Fit session** | 0 | 0 | **$0** |
| **Behavioural session** (3 answers) | 2,022 | 2,615 | **~$0.015** |
| **Case session** (9 turns + 1) | 9,354 | 10,819 | **~$0.063** |

> **Verified (mock-mode choreography, this session):** a clean strong-answer case run =
> **9 candidate turns + 1 final = 10 calls** (`data_reveal` drips 2 exhibits, so it takes
> ~3 turns). Weak answers add probe/redirect/hint turns — the FSM caps at 2 probes + a
> graduated hint ladder, then force-advances — which raises the call count and cost.

### Under a $10 budget (measured, post-fix)

| Module | Cost / session | Sessions per $10 |
|---|---|---|
| Fit | $0 | **unlimited** (no model call) |
| Behavioural | ~$0.015 | **~670** (~2,000 individual answers @ ~$0.005) |
| Case | ~$0.063 | **~160** |

**Is the Case simulator disproportionately expensive? Yes.** It is the only module that makes
**N + 1** calls (one per candidate turn plus a large full-transcript final score), versus
Behavioural's **N** and Fit's **0**. Measured post-fix, a full case ≈ **4.2×** a 3-answer behavioural
session and ∞× Fit — the gap grew slightly vs the truncated first run because genuine per-turn outputs
(~1,099 tokens) are longer than the old capped 900. Weak answers add probe/redirect turns, pushing it
higher. Cost levers: cap turns, trim the final-scoring transcript, or aggregate per-turn evaluations
instead of a separate final call.

---

## Mock vs real comparison

Post-fix, the real Haiku path runs on **every** eval call — scores now diverge from the deterministic
heuristic across the board (in the first run, the calls that fell back were identical to mock).

| Module | Mock | Real (post-fix) | Delta |
|---|---|---|---|
| Fit | O*NET score 36/100 | **36/100, identical** | only the `mock` flag flips (deterministic; no model call) |
| Behavioural | STAR heuristic | genuine Haiku | `leadership` **5/5** (mock 4.6), `data_driven` **5/5** (mock 4.8), `why_this_role` **3/5** (mock 2.5) — all diverge |
| Case | feature heuristic + aggregation | genuine Haiku | all 9 per-turn evals **and** the final diverge from mock (e.g. `intro` `2,1,1,1,4` vs `3,1,1,2,3`); final **5/5** with model-written feedback |

Mock and real are **shape-compatible by construction** — the evaluators short-circuit on `useMocks()`
and the real path coerces Haiku's JSON into the same types — so the UI is unaffected in either mode.

---

## Changes

- **`max_tokens` fix applied and verified** (commit `d0b53f2`): raised eval `maxTokens` to 2000 in
  `lib/behavioural/evaluator.ts`, `lib/fsm/case-evaluator.ts`, and `lib/fsm/case-scoring.ts`, and
  tightened the three system prompts to *"Return compact valid JSON only, with no prose outside the
  JSON."* The post-fix rerun confirms no truncation and genuine Haiku scoring (Findings F1).
- Earlier (commit `ec43839`): opt-in usage log in `lib/claude.ts` + the `verify/real-mode.mjs` driver.
- `.gitignore` now excludes the verification artifacts (`server.log`, `live-verification-output.txt`,
  `live-usage-lines.txt`) so local evidence isn't committed.
- **This report update is report-only.** No rubric, schema (`lib/types.ts`), or module-structure
  changes. F2 (KPC omission) remains a minor open follow-up. `npm test`, `tsc`, `npm run build` pass.

---

## Recommendation — demo mode

- **Behavioural & Case:** demo on **Haiku** — real-mode scoring now works end-to-end (post-fix) and
  is cheap: measured ~**$0.015** per behavioural session, ~**$0.063** per case session. Keep **mock
  mode** as the zero-dependency fallback for offline/no-key demos; the output shape is identical, so
  the UI is unaffected either way.
- **Fit Analyzer:** always live — deterministic and **free** (no model call) in any mode.
- **Sonnet:** reserve strictly for a **final showcase** (`SYNTHESIS_MODEL_MODE=demo`) — **not** used
  in this verification (Haiku is the locked default).
- Net: **Haiku for the working live demo, mock as the safety net, Sonnet only for the final set-piece.**
