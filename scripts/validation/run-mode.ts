export interface ValidationRunConfig {
  smoke: boolean;
  diagnostic: boolean;
  mode: "smoke" | "scoped-real-jd" | "diagnostic";
  inputSuffix: "smoke" | "scoped";
  outputSuffix: string;
  samplePerFamily: number | null;
  minJDRequirements: number;
}

function integerOption(
  argv: string[],
  flag: string,
  options: { minimum: number; fallback: number | null },
): number | null {
  const indexes = argv.flatMap((value, index) => (value === flag ? [index] : []));
  if (indexes.length > 1) throw new Error(`${flag} may be provided only once.`);
  if (!indexes.length) return options.fallback;
  const raw = argv[indexes[0] + 1];
  if (!raw || raw.startsWith("--") || !/^-?\d+$/.test(raw)) {
    throw new Error(`${flag} requires an integer value.`);
  }
  const value = Number.parseInt(raw, 10);
  if (value < options.minimum) {
    throw new Error(`${flag} must be at least ${options.minimum}.`);
  }
  return value;
}

/**
 * Keep publishable scoped outputs separate from diagnostic subsets or
 * non-default parser-gate experiments.
 */
export function resolveValidationRun(argv: string[]): ValidationRunConfig {
  const smoke = argv.includes("--smoke") || argv.includes("--fixtures");
  const samplePerFamily = integerOption(argv, "--sample", {
    minimum: 1,
    fallback: null,
  });
  if (smoke && samplePerFamily !== null) {
    throw new Error("--sample is not supported in smoke mode.");
  }

  const defaultMinJDRequirements = smoke ? 0 : 3;
  const minJDRequirements = integerOption(argv, "--min-jd-requirements", {
    minimum: 0,
    fallback: defaultMinJDRequirements,
  })!;
  const diagnostic =
    !smoke &&
    (samplePerFamily !== null || minJDRequirements !== defaultMinJDRequirements);

  const diagnosticParts = [
    samplePerFamily === null ? null : `sample-${samplePerFamily}`,
    minJDRequirements === defaultMinJDRequirements
      ? null
      : `minjd-${minJDRequirements}`,
  ].filter((value): value is string => value !== null);

  return {
    smoke,
    diagnostic,
    mode: smoke ? "smoke" : diagnostic ? "diagnostic" : "scoped-real-jd",
    inputSuffix: smoke ? "smoke" : "scoped",
    outputSuffix: smoke ? "smoke" : diagnostic ? `diagnostic-${diagnosticParts.join("-")}` : "scoped",
    samplePerFamily,
    minJDRequirements,
  };
}
