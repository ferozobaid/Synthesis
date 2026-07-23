import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface ReportCapability {
  token: string;
  tokenHash: string;
}

export function hashReportToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Return the plaintext capability once; callers persist only tokenHash. */
export function issueReportCapability(): ReportCapability {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashReportToken(token) };
}

export function verifyReportCapability(token: string, storedHashHex: string): boolean {
  try {
    const provided = createHash("sha256").update(token).digest();
    const stored = Buffer.from(storedHashHex, "hex");
    return provided.length === stored.length && timingSafeEqual(provided, stored);
  } catch {
    return false;
  }
}
