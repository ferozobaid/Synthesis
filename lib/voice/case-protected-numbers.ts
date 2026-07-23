export type CanonicalNumericUnit = "number" | "percent" | "years" | "eur" | "usd" | "gbp";

export interface CanonicalNumericClaim {
  value: number;
  unit: CanonicalNumericUnit;
}

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

const SCALE: Record<string, number> = {
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

interface ParsedNumber {
  value: number;
  end: number;
}

function numberish(token: string | undefined): boolean {
  return Boolean(
    token && (
      /^\d+(?:\.\d+)?$/.test(token) ||
      Object.prototype.hasOwnProperty.call(SMALL_NUMBERS, token) ||
      Object.prototype.hasOwnProperty.call(TENS, token) ||
      token === "hundred" ||
      Object.prototype.hasOwnProperty.call(SCALE, token) ||
      token === "point"
    )
  );
}

function tokenized(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(\d(?:[\d,.]*\d|\d)?)\s*k\b/g, "$1 thousand")
    .replace(/(\d(?:[\d,.]*\d|\d)?)\s*m\b/g, "$1 million")
    .replace(/(\d(?:[\d,.]*\d|\d)?)\s*b\b/g, "$1 billion")
    .replace(/(?<=\d),(?=\d)/g, "")
    .match(/[€$£]|\d+(?:\.\d+)?|[a-z]+|%/g) ?? [];
}

function parseNumberAt(tokens: string[], start: number): ParsedNumber | null {
  const first = tokens[start];
  if (!numberish(first) || first === "point") return null;
  if (/^\d+(?:\.\d+)?$/.test(first)) {
    let value = Number(first);
    let end = start + 1;
    if (SCALE[tokens[end]]) {
      value *= SCALE[tokens[end]];
      end += 1;
    }
    return Number.isFinite(value) ? { value, end } : null;
  }

  let current = 0;
  let total = 0;
  let index = start;
  let consumed = false;
  while (index < tokens.length) {
    const token = tokens[index];
    if (Object.prototype.hasOwnProperty.call(SMALL_NUMBERS, token)) {
      current += SMALL_NUMBERS[token];
      consumed = true;
      index += 1;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(TENS, token)) {
      current += TENS[token];
      consumed = true;
      index += 1;
      continue;
    }
    if (token === "hundred") {
      current = Math.max(1, current) * 100;
      consumed = true;
      index += 1;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(SCALE, token)) {
      total += Math.max(1, current) * SCALE[token];
      current = 0;
      consumed = true;
      index += 1;
      continue;
    }
    if (token === "and" && consumed && numberish(tokens[index + 1])) {
      index += 1;
      continue;
    }
    if (token === "point" && consumed) {
      const digits: string[] = [];
      let decimalIndex = index + 1;
      while (DIGIT_WORDS[tokens[decimalIndex]] !== undefined) {
        digits.push(DIGIT_WORDS[tokens[decimalIndex]]);
        decimalIndex += 1;
      }
      if (digits.length > 0) {
        return {
          value: total + current + Number(`0.${digits.join("")}`),
          end: decimalIndex,
        };
      }
    }
    break;
  }
  return consumed ? { value: total + current, end: index } : null;
}

function unitAfter(
  tokens: string[],
  start: number,
  parsed: ParsedNumber,
): { claim: CanonicalNumericClaim; end: number } {
  const suffix = tokens[parsed.end];
  const prefix = tokens[start - 1];
  if (suffix === "year" || suffix === "years") {
    const connector = tokens[parsed.end + 1];
    const months = parseNumberAt(tokens, parsed.end + (connector === "and" ? 2 : 1));
    const monthUnit = months ? tokens[months.end] : null;
    if (months && (monthUnit === "month" || monthUnit === "months")) {
      return {
        claim: { value: parsed.value + months.value / 12, unit: "years" },
        end: months.end + 1,
      };
    }
    return { claim: { value: parsed.value, unit: "years" }, end: parsed.end + 1 };
  }
  if (suffix === "month" || suffix === "months") {
    return { claim: { value: parsed.value / 12, unit: "years" }, end: parsed.end + 1 };
  }
  if (suffix === "%" || suffix === "percent" || suffix === "percentage") {
    return { claim: { value: parsed.value, unit: "percent" }, end: parsed.end + 1 };
  }
  if (prefix === "€" || suffix === "euro" || suffix === "euros" || suffix === "eur") {
    return { claim: { value: parsed.value, unit: "eur" }, end: parsed.end + (suffix === "euro" || suffix === "euros" || suffix === "eur" ? 1 : 0) };
  }
  if (prefix === "$" || suffix === "dollar" || suffix === "dollars" || suffix === "usd") {
    return { claim: { value: parsed.value, unit: "usd" }, end: parsed.end + (suffix === "dollar" || suffix === "dollars" || suffix === "usd" ? 1 : 0) };
  }
  if (prefix === "£" || suffix === "pound" || suffix === "pounds" || suffix === "gbp") {
    return { claim: { value: parsed.value, unit: "gbp" }, end: parsed.end + (suffix === "pound" || suffix === "pounds" || suffix === "gbp" ? 1 : 0) };
  }
  return { claim: { value: parsed.value, unit: "number" }, end: parsed.end };
}

function deduplicate(claims: CanonicalNumericClaim[]): CanonicalNumericClaim[] {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    const key = `${claim.unit}:${claim.value.toPrecision(12)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Parse digit and number-word expressions into comparable values and units. */
export function canonicalNumericClaims(value: string): CanonicalNumericClaim[] {
  const tokens = tokenized(value);
  const claims: CanonicalNumericClaim[] = [];
  for (let index = 0; index < tokens.length;) {
    const parsed = parseNumberAt(tokens, index);
    if (!parsed) {
      index += 1;
      continue;
    }
    const resolved = unitAfter(tokens, index, parsed);
    claims.push(resolved.claim);
    index = Math.max(index + 1, resolved.end);
  }
  return deduplicate(claims);
}

function dataUnit(key: string, inherited: CanonicalNumericUnit): CanonicalNumericUnit {
  const normalized = key.toLowerCase();
  if (normalized.includes("pct") || normalized.includes("percent")) return "percent";
  if (normalized.includes("eur") || normalized.includes("euro")) return "eur";
  if (normalized.includes("usd") || normalized.includes("dollar")) return "usd";
  if (normalized.includes("gbp") || normalized.includes("pound")) return "gbp";
  if (normalized.includes("year") || normalized.includes("month")) return "years";
  return inherited;
}

/** Preserve authored data-key units without exposing or serializing the data itself. */
export function canonicalNumericClaimsFromData(
  value: unknown,
  inheritedUnit: CanonicalNumericUnit = "number",
): CanonicalNumericClaim[] {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (inheritedUnit === "percent") {
      return [{ value: Math.abs(value) <= 1 ? value * 100 : value, unit: "percent" }];
    }
    if (inheritedUnit === "years") return [{ value, unit: "years" }];
    return [{ value, unit: inheritedUnit }];
  }
  if (typeof value === "string") return canonicalNumericClaims(value);
  if (Array.isArray(value)) {
    return deduplicate(value.flatMap((entry) => canonicalNumericClaimsFromData(entry, inheritedUnit)));
  }
  if (value && typeof value === "object") {
    return deduplicate(Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      canonicalNumericClaimsFromData(entry, dataUnit(key, inheritedUnit))
    ));
  }
  return [];
}

export function canonicalNumericClaimsMatch(
  left: CanonicalNumericClaim,
  right: CanonicalNumericClaim,
  tolerance = 1e-8,
): boolean {
  if (left.unit !== right.unit) return false;
  return Math.abs(left.value - right.value) <= Math.max(tolerance, Math.abs(right.value) * 1e-9);
}

export function isOrdinarySmallNumber(claim: CanonicalNumericClaim): boolean {
  return claim.unit === "number" && Number.isInteger(claim.value) && claim.value >= 0 && claim.value <= 10;
}
