# Deployment — Vercel

How to deploy Synthesis to Vercel. The default path is **mock mode**: a fully
demoable public deployment that needs **no API keys**. Real mode (live Claude +
Supabase) is documented in [§ Real-mode deploy](#real-mode-deploy-later--do-not-enable-yet)
so it can be switched on later without re-investigation.

## TL;DR

The app is deployment-safe as-is. All data (case content, behavioural banks, the
O*NET taxonomy) is **statically imported JSON** that bundles at build time — there are
no runtime filesystem reads, and nothing crashes when `ANTHROPIC_API_KEY` is absent.
To deploy in mock mode you set **one** environment variable:

```
SYNTHESIS_USE_MOCKS=true
```

Then import the repo in Vercel (zero-config — `next build` is auto-detected) and deploy.

---

## Mock-mode deploy (do this now)

### Environment variables

| Var | Value on Vercel | Controls |
|---|---|---|
| `SYNTHESIS_USE_MOCKS` | `true` | Pins mock mode — the app serves authored fixtures and never calls Claude or Supabase. |

That is the complete required set. The app would already auto-fall back to mocks with
**no** env vars (mock mode is the default whenever Anthropic + Supabase credentials are
both absent — see `useMocks()` in [lib/config.ts](../lib/config.ts)), but pinning the
flag makes the deployment's mode explicit and immune to a half-configured credential
being added later.

Do **not** set `ANTHROPIC_API_KEY` or any Supabase var for a mock-mode deploy.

### Steps

1. **Confirm the build is green locally** (see [§ Pre-deploy verification](#pre-deploy-verification)).
2. **Import the project** at [vercel.com/new](https://vercel.com/new) → select this Git
   repository. Vercel auto-detects Next.js; leave Build Command (`next build`), Output,
   and Install Command at their defaults. No `vercel.json` is needed or present.
3. **Add the env var**: Project → Settings → Environment Variables →
   `SYNTHESIS_USE_MOCKS = true` for the Production (and Preview) environments.
4. **Deploy**. Or, via CLI: `npm i -g vercel && vercel --prod` (set the env var first
   with `vercel env add SYNTHESIS_USE_MOCKS`).
5. **Smoke-test** the deployed URL (see [§ Smoke test](#smoke-test-post-deploy)).

> `.env.local` is gitignored and never ships to Vercel — environment configuration on
> Vercel comes only from the dashboard / `vercel env`.

---

## Real-mode deploy (later — do NOT enable yet)

Documented so it's ready for PR2 / a live demo. Do not set these now.

| Var | Value | Controls |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` | Enables real Claude calls (Haiku). |
| `SYNTHESIS_USE_MOCKS` | `false` | Turns mocks off. |
| `SYNTHESIS_MODEL_MODE` | `default` | Locked Haiku (`claude-haiku-4-5`). **Do not** use `demo` (Sonnet). |
| `NEXT_PUBLIC_SUPABASE_URL` | project URL | Supabase project. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key | Supabase anon client (RLS-scoped). |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key | Supabase server-only client. |
| `EMBEDDINGS_ENABLED` | `false` | Keep off on Vercel (see limitations). |
| `SYNTHESIS_LOG_USAGE` | `true` *(optional)* | Logs per-call token usage to server logs. |

### The toggle rule (important)

Mock mode is controlled by `useMocks()`:

```
SYNTHESIS_USE_MOCKS=true   → always mock
SYNTHESIS_USE_MOCKS=false  → always real
unset                      → real only if BOTH Anthropic AND Supabase creds are present
```

You **cannot half-enable** real mode. If you set `SYNTHESIS_USE_MOCKS=false` with only
an Anthropic key, real Claude calls work, but any code path that builds a Supabase
client (`supabaseAnon()` / `supabaseService()`) would call `createClient(undefined)` and
throw. So a real-mode deploy requires `SYNTHESIS_USE_MOCKS=false` **plus** the Anthropic
key **plus** all three Supabase vars together. Provision Supabase (schema migrations under
[supabase/migrations/](../supabase/migrations)) before turning real mode on.

---

## Known limitations

- **Serverless function timeout.** No route sets `maxDuration`, so Vercel's default
  applies (~10s on Hobby). Mock mode is fully synchronous (no network) and finishes far
  under the limit. In **real mode**, the case simulator's `respond` path
  ([app/api/case/route.ts](../app/api/case/route.ts)) can chain multiple Haiku calls per
  FSM stage (evaluation + interviewer move + scoring) and may approach the limit under
  load. Future fix, not needed now: add `export const maxDuration = 30;` to the case
  route (Vercel Pro allows higher). No action required for a mock-mode deploy.
- **No authentication yet.** Sessions use a fixed mock user id; the app is open to
  anyone with the URL. Don't deploy real user data until Supabase Auth is wired.
- **No live retrieval / pgvector.** RAG runs on a deterministic mock embedder; semantic
  ranking is not active. Real BGE-small embeddings require local infra and are not run on
  Vercel.
- **Keep `EMBEDDINGS_ENABLED=false` on Vercel.** `@xenova/transformers` is an optional
  dependency that is **not** in `package.json` and won't be installed on Vercel. The code
  hides it behind an indirect import with a try/catch fallback to the mock embedder, so
  enabling the flag would not crash — it would just silently fall back. Leave it off.

---

## Pre-deploy verification

Both pass on a clean checkout (last verified locally):

```bash
npm test        # 86 passed
npm run build   # Compiled successfully — 10/10 pages, no fs/bundling warnings
```

To exercise **mock mode** locally even when your `.env.local` holds real credentials,
override the flag for the run:

```bash
SYNTHESIS_USE_MOCKS=true npm run build
SYNTHESIS_USE_MOCKS=true npm start   # http://localhost:3000
```

---

## Smoke test (post-deploy)

Replace `$URL` with your deployed origin (e.g. `https://synthesis.vercel.app`).

**Pages** — open in a browser, each should render:

- `GET $URL/` — home with links to the three modules
- `GET $URL/fit`
- `GET $URL/behavioural`
- `GET $URL/case`

**API** (mock mode returns `mock: true` / authored fixtures):

```bash
# Fit analyzer — deterministic, returns a real scored report even in mock mode
curl -s -X POST $URL/api/fit/analyze \
  -H 'content-type: application/json' \
  -d '{"resumeText":"SQL, Python, Power BI; built outlet-level reporting.","jdText":"Data Analyst. SQL required, Python a plus."}'
# → { "mock": true, "report": { "overall_score": … }, "jd": {…}, "resume_skills": [...] }

# Behavioural — start a session (JD-grounded questions)
curl -s -X POST $URL/api/behavioural \
  -H 'content-type: application/json' \
  -d '{"action":"start"}'
# → { session…, questions: [...] }

# Case — start the Beautify case (opening prompt + intro context)
curl -s -X POST $URL/api/case \
  -H 'content-type: application/json' \
  -d '{"action":"start","caseId":"beautify"}'
# → { session…, prompt…, … }
```

If all four pages load and the three POSTs return JSON, the deployment is live in mock
mode.

---

## Why this is safe on serverless (architecture note)

- **No runtime `fs`.** Case content, the behavioural question/seed-answer banks, and the
  64K O*NET taxonomy are pulled in as static `import … from "@/…json"`
  ([lib/__mocks__/fixtures.ts](../lib/__mocks__/fixtures.ts),
  [lib/onet.ts](../lib/onet.ts)) with `resolveJsonModule` on — they are inlined into the
  function bundle at build time, not read from disk at request time.
- **No top-level client construction.** The Anthropic and Supabase clients are built
  lazily inside mock-gated functions ([lib/claude.ts](../lib/claude.ts),
  [lib/supabase.ts](../lib/supabase.ts)), so importing a route never touches a missing
  key.
- **Optional native deps stay out of the bundle.** The embeddings extractor is loaded via
  an indirect dynamic import the bundler can't see ([lib/embeddings.ts](../lib/embeddings.ts)).
