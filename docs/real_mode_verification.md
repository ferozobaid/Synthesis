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
| **Status** | **Setup complete — billed run PENDING.** Mock-mode choreography verified end-to-end via `verify/real-mode.mjs` (all 3 modules complete; zero billed calls). Live Haiku run to be done by Feroz with a local key. |

> This document is pre-filled with everything determinable statically. Cells marked
> **`PENDING`** are filled in after running the live session (see *How to run*). The
> estimates in the Cost section are clearly labelled and should be replaced with measured
> numbers from the usage log.

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
| Coherence spot-check | `PENDING` (eyeball score + strengths/gaps on the consultant sample) |
| Cost | **$0** |

### Module 2 — Behavioural Simulator
| Field | Value |
|---|---|
| Uses `complete()` | **Yes** — 1 call per answered question |
| `extractJSON` parses to `BehaviouralScore` | `PENDING` |
| Fallback heuristic triggered | `PENDING (expected: no)` |
| Output shape | `PENDING` — expect `dimension_scores[]` (1-5), `overall`, `strengths`, `improvements`, covered/missed key points |
| Coherence spot-check | `PENDING` — scores plausible vs the STAR answer; `key_point_coverage` scored when a prepared answer matched (`leadership`, `data_driven_decision`), marked **N/A** when none matched (`why_this_role`) |
| Driver inputs | questions `leadership`, `data_driven_decision`, `why_this_role` with strong STAR answers; JD = `context/jd_samples/consultant.txt` |

### Module 3 — Case Simulator
| Field | Value |
|---|---|
| Uses `complete()` | **Yes** — per-turn eval **and** final scoring |
| `extractJSON` parses to `Evaluation` / `CaseScore` | `PENDING` |
| Fallback heuristic triggered | `PENDING (expected: no)` |
| Output shape | `PENDING` — per-turn `Evaluation` (5 dims, overall, strengths/improvements/next_focus) + final `CaseScore` |
| Coherence spot-check | `PENDING` — strong answers should advance the FSM cleanly and yield a high, well-justified final score; payback ≈1.28y and the "Lena/virtual-try-on" insight should surface |
| Driver inputs | case `beautify`, strong per-stage answers grounded in the rubric/target elements |

### Detecting a fallback (important)

A fallback returns **heuristic-shaped output silently** (no error to the caller). Detect it by:
1. **No `[synthesis usage]` line** printed server-side for that call → the real call threw and the heuristic ran.
2. Justification strings exactly match the fixed heuristic text (e.g. case "Clear, signposted, MECE-style structure.").

**If a fallback triggers:** capture the raw model response, determine why (`extractJSON` couldn't find `{...}`, malformed JSON, network error, etc.).
- Fix **only** if it's a small prompt-wording or `extractJSON` robustness issue.
- **Stop and report** if it's a structural schema mismatch (the coercion layer can't map the model's shape to the expected type) — that's a design decision, not a verification fix.

---

## Token usage (`PENDING` — from the `SYNTHESIS_LOG_USAGE` log)

`complete()` now emits one line per real call (gated on `SYNTHESIS_LOG_USAGE=true`):
`[synthesis usage] model=claude-haiku-4-5 input_tokens=… output_tokens=…`.

| Call | maxTokens | input_tokens | output_tokens |
|---|---|---|---|
| Behavioural — per answer | 900 | `PENDING` | `PENDING` |
| Case — per-turn eval | 900 | `PENDING` | `PENDING` |
| Case — final score | 1200 | `PENDING` | `PENDING` |
| **Behavioural session** (3 answers) | — | `PENDING` | `PENDING` |
| **Case session** (≈9 turns + 1 ≈ 10 calls) | — | `PENDING` | `PENDING` |

---

## Estimated cost (replace with measured numbers)

**Haiku 4.5 pricing (authoritative):** **$1.00 / 1M input**, **$5.00 / 1M output** (200K context).
→ `cost = input_tokens × $1e-6 + output_tokens × $5e-6`.

> The figures below are **ESTIMATES** from prompt sizes + `maxTokens`, pending measured tokens.

| Unit | Est. input | Est. output | Est. cost |
|---|---|---|---|
| Behavioural — per answer | ~700 | ~450 | **~$0.003** ($0.002–0.004) |
| Case — per-turn eval | ~600 | ~400 | **~$0.003** ($0.002–0.004) |
| Case — final score | ~2200 | ~600 | **~$0.005** ($0.004–0.008) |
| **Fit session** | 0 | 0 | **$0** |
| **Behavioural session** (3 answers) | — | — | **~$0.01** ($0.006–0.012) |
| **Case session** (≈9 turns + 1 ≈ 10 calls) | — | — | **~$0.03** ($0.02–0.04) |

> **Verified (mock-mode choreography, this session):** a clean strong-answer case run =
> **9 candidate turns + 1 final = 10 calls** (`data_reveal` drips 2 exhibits, so it takes
> ~3 turns). Weak answers add probe/redirect/hint turns — the FSM caps at 2 probes + a
> graduated hint ladder, then force-advances — which raises the call count and cost.

### Under a $10 budget (estimated)

| Module | Cost / session | Sessions per $10 |
|---|---|---|
| Fit | $0 | **unlimited** (no model call) |
| Behavioural | ~$0.01 | **~1,000** (~3,000+ individual answers) |
| Case | ~$0.03 | **~300** (range ~250–500) |

**Is the Case simulator disproportionately expensive? Yes.** It is the only module that
makes **N + 1** calls (one per candidate turn plus a final, large full-transcript scoring
call), versus Behavioural's **N** (one per answer) and Fit's **0**. A full case ≈ **3×** a
3-answer behavioural session and ∞× Fit. Weak candidate answers add probe/redirect turns,
pushing it higher. Cost levers if needed later: cap turns, trim the final-scoring transcript,
or skip the separate final call and aggregate per-turn evaluations.

---

## Mock vs real comparison

| Module | Mock | Real | Expected delta |
|---|---|---|---|
| Fit | deterministic O*NET score | **identical** | only the `mock` flag flips; diff the driver `fingerprint` to confirm |
| Behavioural | STAR heuristic | Haiku rubric scoring | `PENDING` — same `BehaviouralScore` shape; scores/feedback may differ in wording/level |
| Case | feature heuristic + aggregation | Haiku per-turn + holistic final | `PENDING` — same `Evaluation`/`CaseScore` shape; expect richer, transcript-citing feedback |

Mock and real are **shape-compatible by construction** — the evaluators short-circuit on
`useMocks()` and the real path coerces Haiku's JSON into the exact same types, so the UI and
downstream code are unchanged across modes.

---

## Small fixes made this session

- **`lib/claude.ts`** — added an opt-in, off-by-default usage log inside `complete()` (gated
  on `SYNTHESIS_LOG_USAGE=true`) so input/output token counts can be measured. No change to
  the return type, `lib/types.ts`, mock-mode behaviour, or the default real-mode path.
- **`verify/real-mode.mjs`** — standalone HTTP driver (imports nothing from `/app`,`/lib`,`/scripts`).
- No rubric, schema, or module-structure changes. `npm test` and `npm run build` pass.

---

## Recommendation — demo mode

- **Fit Analyzer:** always live — it's deterministic and **free** (no model call) in any mode.
- **Behavioural & Case:** demo on **Haiku**. The real paths are cheap (~$0.01 and ~$0.03 per
  session, estimated) and showcase genuine model-generated scoring/feedback. Keep **mock mode**
  as the zero-dependency fallback for offline or no-key demos — output shape is identical, so
  the UI is unaffected.
- **Sonnet:** reserve strictly for a **final showcase** if a noticeably higher-quality
  transcript is wanted, toggled via `SYNTHESIS_MODEL_MODE=demo` — **not** used in this
  verification (Haiku is the locked default).
- Net: **Haiku for the working live demo, mock as the safety net, Sonnet only for the final
  set-piece.**
