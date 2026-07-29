from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import validate_matching


class ValidationManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.artifacts = Path(self.temp.name)
        self.input_resume = self.artifacts / "resumes.scoped.jsonl"
        self.input_jd = self.artifacts / "jds.scoped.jsonl"
        self.sampling_report = self.artifacts / "sampling_report.scoped.json"
        self.parser_diagnostics = self.artifacts / "jd_parse_diagnostics.scoped.json"
        self.implementation = self.artifacts / "score_resumes.ts"
        self.model_file = self.artifacts / "model_quantized.onnx"
        for path in [
            self.input_resume,
            self.input_jd,
            self.sampling_report,
            self.parser_diagnostics,
            self.implementation,
            self.model_file,
        ]:
            path.write_text(f"{path.name}\n", encoding="utf-8")
        self.results = self.artifacts / "results.scoped.jsonl"
        self.results.write_text('{"id":"resume-1"}\n', encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def file_hash(self, path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def write_manifest(
        self,
        *,
        backend: str,
        result_hash: str | None = None,
        mode: str = "scoped-real-jd",
    ) -> None:
        relative = lambda path: path.name
        model_files = {
            relative(self.model_file): self.file_hash(self.model_file),
        }
        bundle_hash = hashlib.sha256(
            json.dumps(model_files, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        manifest = {
            "mode": mode,
            "diagnostic_parameters": None,
            "implementation_sha256": {
                relative(self.implementation): self.file_hash(self.implementation),
            },
            "embedding": {
                "backend": backend,
                "fallback_allowed": False,
                "requested_revision": "pinned-revision",
                "revision_enforced_for_remote_loading": True,
                "source": "packaged-local",
                "model_bundle_sha256": bundle_hash,
                "model_files_sha256": model_files,
            },
            "inputs": {
                "resumes": relative(self.input_resume),
                "resumes_sha256": self.file_hash(self.input_resume),
                "resume_source_rows": 1,
                "resume_rows": 1,
                "jds": relative(self.input_jd),
                "jds_sha256": self.file_hash(self.input_jd),
                "sampling_report": relative(self.sampling_report),
                "sampling_report_sha256": self.file_hash(self.sampling_report),
            },
            "parser_gate": {
                "diagnostics": relative(self.parser_diagnostics),
                "diagnostics_sha256": self.file_hash(self.parser_diagnostics),
            },
            "output": {
                "results_sha256": result_hash
                or self.file_hash(self.results),
                "result_rows": 1,
            },
        }
        (self.artifacts / "validation_manifest.scoped.json").write_text(
            json.dumps(manifest),
            encoding="utf-8",
        )

    def test_scoped_manifest_requires_bge(self) -> None:
        self.write_manifest(backend="mock")
        with (
            patch.object(validate_matching, "ART", self.artifacts),
            patch.object(validate_matching, "REPO", self.artifacts),
            self.assertRaisesRegex(SystemExit, "expected 'bge'"),
        ):
            validate_matching.read_validation_manifest(False, self.results)

    def test_manifest_requires_matching_result_hash(self) -> None:
        self.write_manifest(backend="bge", result_hash="not-the-current-hash")
        with (
            patch.object(validate_matching, "ART", self.artifacts),
            patch.object(validate_matching, "REPO", self.artifacts),
            self.assertRaisesRegex(SystemExit, "does not match the manifest hash"),
        ):
            validate_matching.read_validation_manifest(False, self.results)

    def test_valid_scoped_manifest_is_accepted(self) -> None:
        self.write_manifest(backend="bge")
        with (
            patch.object(validate_matching, "ART", self.artifacts),
            patch.object(validate_matching, "REPO", self.artifacts),
        ):
            manifest = validate_matching.read_validation_manifest(False, self.results)
        self.assertEqual(manifest["embedding"]["backend"], "bge")

    def test_diagnostic_manifest_cannot_publish_scoped_metrics(self) -> None:
        self.write_manifest(backend="bge", mode="diagnostic")
        with (
            patch.object(validate_matching, "ART", self.artifacts),
            patch.object(validate_matching, "REPO", self.artifacts),
            self.assertRaisesRegex(SystemExit, "Diagnostic runs cannot publish"),
        ):
            validate_matching.read_validation_manifest(False, self.results)

    def test_manifest_requires_sampling_report_evidence(self) -> None:
        self.write_manifest(backend="bge")
        self.sampling_report.unlink()
        with (
            patch.object(validate_matching, "ART", self.artifacts),
            patch.object(validate_matching, "REPO", self.artifacts),
            self.assertRaisesRegex(SystemExit, "sampling report file is missing"),
        ):
            validate_matching.read_validation_manifest(False, self.results)


if __name__ == "__main__":
    unittest.main()
