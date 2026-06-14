# scripts/validation/ — build in Step 9 (owner: Rui)

- `profile_datasets.py` — reproduce the EDA numbers (2,484 resumes, the 24-class
  distribution, dedup counts, quality-trap prevalences). Verify against `EDA_Report-.docx`.
- `validate_matching.py` — test the falsifiable claim that a resume scores highest
  against postings from its own field. Emit **top-1 / top-3 accuracy, a confusion
  matrix, and an embeddings-vs-structured ablation** on fixtures.

Targets (from the proposal): **top-1 ≥ 70%, top-3 ≥ 90%**.
