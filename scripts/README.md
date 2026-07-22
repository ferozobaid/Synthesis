# scripts/ - Offline Plane

Never imported by `/app` or `/lib`; a test enforces this boundary.

- `validation/` - scoped real-JD validation, reporting, and smoke fixtures.
- `onet/` - scripts for maintaining the committed O*NET taxonomy dictionary.

Rules:

- `ANTHROPIC_API_KEY` is never set in any script.
- Datasets are dev/validation only.
- OpenAI usage is limited to the validation LLM family mapper.
- O*NET is not ingested into a remote database; runtime code reads
  `lib/data/onet-taxonomy.json`.
