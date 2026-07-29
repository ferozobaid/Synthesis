import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repo = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(repo, relativePath), "utf8");
}

describe("LLM-only validation mapper cleanup", () => {
  it("removes the standalone keyword mapper", () => {
    expect(existsSync(join(repo, "scripts/validation/family_map.py"))).toBe(false);

    const preparation = read("scripts/validation/prepare_data.py");
    expect(preparation).not.toContain("map_title");
    expect(preparation).not.toContain("keyword_scoped");
    expect(preparation).toContain("cached_llm_labels");
    expect(preparation).toContain("--allow-llm-calls");
  });

  it("removes keyword-versus-LLM comparison code and documentation", () => {
    const readme = read("scripts/validation/README.md");
    const protocol = read("scripts/validation/HUMAN_VALIDATION_PROTOCOL.md");

    expect(readme.toLowerCase()).not.toContain("keyword-vs-llm");
    expect(protocol).not.toContain("Mapper comparison");
    expect(protocol).not.toContain("keyword and LLM accuracy");
  });

  it("removes the legacy human and synthetic field-profile workflows", () => {
    const removedPaths = [
      "scripts/validation/human_validation.ts",
      "scripts/validation/fit_validation.ipynb",
      "scripts/validation/field_profiles.json",
      "scripts/validation/fixtures/field_profiles.json",
      "scripts/validation/fixtures/resumes.jsonl",
      "reports/Human_Pair_Validation_Pilot.md",
    ];
    for (const path of removedPaths) {
      expect(existsSync(join(repo, path)), path).toBe(false);
    }

    const packageJson = read("package.json");
    expect(packageJson).not.toContain('"validate:human"');
    expect(packageJson).not.toContain('"validate:human:smoke"');
    expect(packageJson).toContain('"validate:human54"');
  });

  it("uses strict BGE and the tested family-normalized helper in code validation", () => {
    const scorer = read("scripts/validation/score_resumes.ts");
    const embeddings = read("lib/embeddings.ts");
    expect(scorer).toContain("embedBatchStrict");
    expect(scorer).toContain('import { combine } from "./rank"');
    expect(scorer).toContain("validation_manifest.");
    expect(scorer).toContain("model_bundle_sha256");
    expect(embeddings).toContain("revision: embeddingsModelRevision()");
    expect(scorer).not.toContain("function minMax(");
    expect(scorer).not.toContain("function blend(");
  });
});
