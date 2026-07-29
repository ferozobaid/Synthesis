from __future__ import annotations

import csv
import json
import os
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import prepare_data
from llm_family_map import posting_cache_key


def posting(job_id: str, title: str) -> dict[str, str]:
    return {
        "job_id": job_id,
        "company_name": "Validation Company",
        "title": title,
        "description": (
            "This is a sufficiently detailed real-job-style description used to "
            "exercise the offline validation preparation workflow."
        ),
        "skills_desc": "Analysis, communication, and role-specific experience",
    }


def cached_mapping(row: dict[str, str], family: str) -> dict[str, object]:
    return {
        "cache_key": posting_cache_key(row),
        "job_id": row["job_id"],
        "title": row["title"],
        "company_name": row["company_name"],
        "family": family,
        "confidence": 0.95,
        "rationale": "Cached LLM classification for a validation test.",
        "error": None,
        "model": "test-model",
    }


class PrepareDataLlmOnlyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.postings_path = self.root / "postings.csv"
        self.cache_path = self.root / "posting_family_map.jsonl"
        self.output_path = self.root / "jds.scoped.jsonl"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_postings(self, rows: list[dict[str, str]]) -> None:
        with self.postings_path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(
                fh,
                fieldnames=[
                    "job_id",
                    "company_name",
                    "title",
                    "description",
                    "skills_desc",
                ],
            )
            writer.writeheader()
            writer.writerows(rows)

    def write_cache(self, rows: list[dict[str, object]]) -> None:
        self.cache_path.write_text(
            "".join(json.dumps(row) + "\n" for row in rows),
            encoding="utf-8",
        )

    def args(self, *, allow_llm_calls: bool) -> Namespace:
        return Namespace(
            cache=str(self.cache_path),
            jd_per_family=1,
            min_confidence=0.75,
            allow_llm_calls=allow_llm_calls,
            max_llm_calls=10,
            delay=0.0,
        )

    def prepare(self, args: Namespace) -> dict[str, object]:
        with (
            patch.object(prepare_data, "REPO", self.root),
            patch.object(prepare_data, "POSTINGS_CSV", self.postings_path),
        ):
            return prepare_data.prepare_jds(args, path=self.output_path)

    def test_complete_cache_makes_no_llm_calls(self) -> None:
        rows = [
            posting("it-1", "Software Engineer"),
            posting("finance-1", "Financial Analyst"),
            posting("consultant-1", "Management Consultant"),
        ]
        self.write_postings(rows)
        self.write_cache(
            [
                cached_mapping(rows[0], "INFORMATION-TECHNOLOGY"),
                cached_mapping(rows[1], "FINANCE"),
                cached_mapping(rows[2], "CONSULTANT"),
            ]
        )

        with patch.object(
            prepare_data,
            "classify_posting",
            side_effect=AssertionError("The LLM must not be called for a complete cache."),
        ):
            stats = self.prepare(self.args(allow_llm_calls=False))

        self.assertEqual(stats["api_calls"], 0)
        self.assertEqual(stats["cache_hits"], 3)
        self.assertEqual(
            stats["selected"],
            {
                "INFORMATION-TECHNOLOGY": 1,
                "FINANCE": 1,
                "CONSULTANT": 1,
            },
        )
        self.assertEqual(stats["passes"][0]["name"], "cached_llm_labels")
        self.assertEqual(len(self.output_path.read_text(encoding="utf-8").splitlines()), 3)

    def test_incomplete_cache_fails_without_overwriting_output(self) -> None:
        rows = [
            posting("it-1", "Software Engineer"),
            posting("finance-1", "Financial Analyst"),
            posting("consultant-1", "Management Consultant"),
        ]
        self.write_postings(rows)
        self.write_cache([cached_mapping(rows[0], "INFORMATION-TECHNOLOGY")])

        with (
            patch.object(
                prepare_data,
                "classify_posting",
                side_effect=AssertionError("Cache-only mode must not call the LLM."),
            ),
            self.assertRaisesRegex(SystemExit, "available cached LLM labels"),
        ):
            self.prepare(self.args(allow_llm_calls=False))

        self.assertFalse(self.output_path.exists())

    def test_uncached_classification_requires_explicit_opt_in(self) -> None:
        rows = [
            posting("it-1", "Software Engineer"),
            posting("finance-1", "Financial Analyst"),
            posting("consultant-1", "Management Consultant"),
        ]
        self.write_postings(rows)
        self.write_cache([cached_mapping(rows[0], "INFORMATION-TECHNOLOGY")])
        families = {
            "finance-1": "FINANCE",
            "consultant-1": "CONSULTANT",
        }

        def classify(row: dict[str, str], api_key: str, model: str) -> dict[str, object]:
            return cached_mapping(row, families[row["job_id"]])

        with (
            patch.object(prepare_data, "classify_posting", side_effect=classify) as mocked,
            patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=False),
        ):
            stats = self.prepare(self.args(allow_llm_calls=True))

        self.assertEqual(mocked.call_count, 2)
        self.assertEqual(stats["api_calls"], 2)
        self.assertEqual(stats["passes"][0]["name"], "cached_llm_labels")
        self.assertEqual(stats["passes"][1]["name"], "uncached_llm_classification")
        self.assertEqual(
            stats["selected"],
            {
                "INFORMATION-TECHNOLOGY": 1,
                "FINANCE": 1,
                "CONSULTANT": 1,
            },
        )


if __name__ == "__main__":
    unittest.main()
