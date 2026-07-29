import { describe, expect, it } from "vitest";

import { resolveValidationRun } from "@/scripts/validation/run-mode";

describe("validation run output isolation", () => {
  it("uses publishable scoped paths only for the full default run", () => {
    expect(resolveValidationRun([])).toMatchObject({
      mode: "scoped-real-jd",
      inputSuffix: "scoped",
      outputSuffix: "scoped",
      diagnostic: false,
      samplePerFamily: null,
      minJDRequirements: 3,
    });
  });

  it("isolates a sampled run from publishable scoped artifacts", () => {
    expect(resolveValidationRun(["--sample", "10"])).toMatchObject({
      mode: "diagnostic",
      inputSuffix: "scoped",
      outputSuffix: "diagnostic-sample-10",
      diagnostic: true,
      samplePerFamily: 10,
    });
  });

  it("isolates a non-default parser-gate experiment", () => {
    expect(resolveValidationRun(["--min-jd-requirements", "2"])).toMatchObject({
      mode: "diagnostic",
      outputSuffix: "diagnostic-minjd-2",
      diagnostic: true,
      minJDRequirements: 2,
    });
  });

  it("rejects malformed or ambiguous sample arguments", () => {
    expect(() => resolveValidationRun(["--sample"])).toThrow(
      "--sample requires an integer value.",
    );
    expect(() => resolveValidationRun(["--sample", "0"])).toThrow(
      "--sample must be at least 1.",
    );
    expect(() => resolveValidationRun(["--smoke", "--sample", "1"])).toThrow(
      "--sample is not supported in smoke mode.",
    );
  });
});
