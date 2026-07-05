# Claude Code — Session 1 Kickoff Prompt for SYNTHESIS

Copy everything between the lines into Claude Code, run from an empty folder.
Use plan mode first (shift+tab) and approve the plan before it builds.

---------------------------------------------------------------------------

You are helping a 4-person team build SYNTHESIS, an interview-preparation
platform, over a 12-week capstone. Today is Session 1: scaffold the repo,
lock the data contracts, and write the CLAUDE.md that will govern all
future sessions. Do NOT build features today beyond what is listed.

## What Synthesis is

Three modules sharing one backbone:
1. Resume-to-JD Fit Analyzer — user uploads a resume (PDF/DOCX) and a job
   description; we parse both, match per-requirement, and return an
   interpretable fit score (matched / partial / missing per requirement,
   gaps, missing keywords, suggestions). A shared JD parser extracts
   company name, role title, and structured requirements.
2. Behavioural Interview Simulator — asks behavioural questions (tell me
   about yourself; why this role; why this company [company name comes
   from the parsed JD]; biggest strengths; a time you failed; a time you
   showed leadership). The user's own prepared answers live in Word docs
   that get ingested into a per-user answer bank; the coach retrieves them
   and scores the user's attempt against their own intended key points.
3. Case Interview Simulator — adaptive consulting case interview driven by
   a finite-state machine over stages (intro → clarifying → framework →
   analysis → math → brainstorm → synthesis → feedback). The interviewer
   agent probes, redirects, drips data, and gives graduated hints.

Both interview modules get voice later (browser STT/TTS). Text first.

## Architecture rules (these go in CLAUDE.md verbatim)

- Two planes. LIVE plane: Next.js app + API routes, direct streaming calls
  to the Anthropic API, retrieval from Supabase pgvector. OFFLINE plane:
  ingestion pipeline (extract → clean → chunk → embed → upsert),
  orchestrated externally by n8n. NOTHING from the offline plane is ever
  on a live request path. Never route a live conversation turn through
  n8n or any extra orchestration hop.
- All agent outputs that feed the UI are strict JSON validated against
  schemas in /schemas. No free-form agent output crosses an API boundary.
- Cases, the behavioural question bank, rubrics, and hint ladders are DATA
  (JSON files in /content), never hardcoded in application code.
- Per-user documents (resumes, JDs, answer banks) are isolated with
  Supabase Auth + row-level security. Users can delete their data.
- Embeddings come from a dedicated embedding model (Voyage AI by default,
  configurable), not the LLM.
- Folder ownership (one team member each — keep changes inside your lane):
  /app + /components + /lib/voice        → Frontend/Voice
  /app/api + /agents + /prompts + /lib/state → Backend/Agents
  /ingestion + /lib/retrieval + /supabase    → Data/RAG
  /schemas + /content + /rubrics             → Content/Product (repo owner)
- Conventional commits. Feature branches (feat/ui-*, feat/agents-*,
  feat/rag-*, feat/content-*). Nothing merges to main without review.

## Build today, in this order

1. Initialize a Next.js 14+ (App Router, TypeScript) project. Tailwind.
   Set up the folder structure above with placeholder README.md in each
   owned folder stating its owner and purpose.
2. Write CLAUDE.md at the repo root containing: project summary, the
   architecture rules above, folder ownership, the tech stack, coding
   conventions (TypeScript strict, zod validation at API boundaries,
   small pure functions, tests alongside code), and session etiquette
   (plan before building, stay in your lane, never commit secrets).
3. Create /schemas with zod schemas AND exported JSON Schema for:
   - jd_requirements: company, role_title, must_have[], nice_to_have[],
     seniority, years_experience, domain, education, raw_text_ref
   - fit_report: overall_score (0-100), per_requirement[] {requirement,
     status: matched|partial|missing, evidence, weight}, top_strengths[],
     gaps[], missing_keywords[], suggestions[]
   - case: id, title, type, industry, prompt, stages[] {id, objective,
     advance_criteria, probe_bank[], data_drops[], hint_ladder[3]},
     exhibits[], target_solution_notes
   - session_state: session_id, user_id, module, case_id?, current_stage,
     stage_attempts, hints_used, math_completed, transcript_ref, complete
   - evaluation: module, dimension_scores[] {dimension, score_1_to_10,
     justification, transcript_evidence}, overall, strengths[],
     improvements[], next_focus
   - behavioural_answer: question_id, user_id, key_points[], star
     {situation, task, action, result}, source_doc_ref
4. Create /content with: one fully-written example case JSON (coffee chain
   profitability, all stages, probe banks, a 3-level hint ladder, one data
   drop with real-looking numbers); the behavioural question bank JSON
   with the six questions above; one example rubric JSON per module.
5. Create /supabase with SQL migrations: users via Supabase Auth; tables
   for documents, document_chunks (with pgvector embedding column +
   HNSW index), sessions, transcripts, evaluations, fit_reports. RLS
   policies isolating rows by user_id. A docker-compose or supabase CLI
   config for local dev.
6. Stub API routes that validate against the schemas and return realistic
   mock data: POST /api/fit (accepts resume+jd text), POST /api/interview/
   turn, POST /api/ingest. Wire NO real LLM calls yet — mocks only, so
   the frontend lane can start immediately.
7. .env.example listing every secret we will need (ANTHROPIC_API_KEY,
   VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE),
   a .gitignore that excludes .env*, and a root README with setup steps
   and the 12-week phase plan.
8. Vercel-ready config. Verify `npm run build` passes and `npm run dev`
   serves a placeholder home page with links to the three modules.

Definition of done: build passes, schemas exported and used by the stub
routes, CLAUDE.md exists, example case JSON validates against the case
schema, and the repo is ready to push to GitHub for the team to clone.

---------------------------------------------------------------------------

# Pattern for every session AFTER this one

Keep sessions to ONE scoped task. Template:

"Read CLAUDE.md. We are in the [lane name] lane. Task: [one feature, e.g.
'implement POST /api/fit for real: parse uploaded PDF/DOCX resume text,
call the JD parser agent (prompt in /prompts/jd_parser.md), match
per-requirement using Voyage embeddings cosine similarity plus exact-skill
rules, return a fit_report validating against /schemas/fit_report'].
Constraints: [anything specific]. Plan first; wait for my approval.
Write tests. Do not touch files outside this lane."

Good early sessions, in order:
- Agents lane: JD parser agent + prompt, real /api/fit
- RAG lane: ingestion CLI (extract/clean/chunk/embed/upsert to pgvector)
- Frontend lane: upload UI + fit report view against the mock API
- Content lane: remaining 4 case JSONs, behavioural rubric calibration set
