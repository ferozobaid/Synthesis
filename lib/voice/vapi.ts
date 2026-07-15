/**
 * Vapi webhook plumbing shared by the behavioural and case tool routes:
 * bearer authentication, tool-call extraction, and the results envelope.
 *
 * Follows Vapi's current documented server event: message.toolCallList entries
 * of { id, name, parameters }, with a defensive fallback to toolWithToolCallList.
 * The response is the current shape { results: [{ name, toolCallId, result }] }
 * where `result` is a string — not the older OpenAI function.arguments assumption.
 *
 * Server (live) plane only.
 */
import { NextResponse } from "next/server";

/** Cap on a single spoken answer we will process (defensive; long inputs rejected). */
export const MAX_ANSWER_LENGTH = 20_000;

export interface NormalizedToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}

/** Parameters may arrive as an object or a JSON string (legacy shapes). */
function coerceParams(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

/**
 * Normalize whatever tool-call container Vapi sends into a flat list. Handles the
 * current `message.toolCallList`, the defensive `message.toolWithToolCallList`,
 * and a last-resort top-level `message.toolCalls`.
 */
export function extractToolCalls(body: unknown): NormalizedToolCall[] {
  const message = (body as { message?: unknown } | null)?.message as Record<string, unknown> | undefined;
  if (!message) return [];

  const out: NormalizedToolCall[] = [];
  const push = (candidate: unknown): void => {
    const tc = candidate as Record<string, unknown> | null;
    if (!tc || typeof tc !== "object") return;
    const id =
      typeof tc.id === "string"
        ? tc.id
        : typeof tc.toolCallId === "string"
          ? tc.toolCallId
          : "";
    if (!id || out.some((o) => o.id === id)) return;
    const fn = tc.function as Record<string, unknown> | undefined;
    const name =
      typeof tc.name === "string"
        ? tc.name
        : typeof fn?.name === "string"
          ? fn.name
          : "";
    const parameters = coerceParams(tc.parameters ?? tc.arguments ?? fn?.arguments);
    out.push({ id, name, parameters });
  };

  const list = message.toolCallList;
  if (Array.isArray(list)) list.forEach(push);

  const withList = message.toolWithToolCallList;
  if (Array.isArray(withList)) {
    withList.forEach((entry) => push((entry as { toolCall?: unknown })?.toolCall ?? entry));
  }

  const top = message.toolCalls;
  if (Array.isArray(top)) top.forEach(push);

  return out;
}

export function findToolCall(
  calls: NormalizedToolCall[],
  name: string,
): NormalizedToolCall | undefined {
  return calls.find((c) => c.name === name);
}

/**
 * Constant-time token comparison. Returns false immediately on a length
 * mismatch (the lengths themselves are not secret and are surfaced only through
 * the opt-in diagnostics below — never the bytes).
 */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify `Authorization: Bearer <VAPI_WEBHOOK_SECRET>`. Returns an error response
 * to short-circuit with, or null when the request is authorized.
 *
 * Fails closed: a missing secret rejects the request (500) and a bad/absent token
 * rejects it (401). API responses never carry diagnostic metadata. When
 * VAPI_AUTH_DEBUG === "true" (off by default), a safe SERVER-ONLY line is logged
 * on failure — presence + character lengths + match result ONLY, never the
 * secret, the token, or any substring/fingerprint of them.
 */
export function authorizeVapi(req: Request): NextResponse | null {
  // Root-cause fix: the token side was already trimmed on extraction, but the
  // secret side was compared raw. A secret injected with a trailing newline
  // (a common `vercel env` / `echo` artifact) then never matched. Trim both.
  const rawSecret = process.env.VAPI_WEBHOOK_SECRET;
  const secret = rawSecret?.trim();
  const header = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? "";
  const matched = !!secret && token.length > 0 && tokensMatch(token, secret);

  // Safe, server-only diagnostic — never included in any API response body.
  if (!matched && process.env.VAPI_AUTH_DEBUG === "true") {
    console.warn("[vapi-auth] authorization failed", {
      secretPresent: !!rawSecret,
      // Raw (un-trimmed) length so a stray trailing byte is still visible here.
      secretLength: rawSecret ? rawSecret.length : 0,
      authHeaderPresent: header.length > 0,
      tokenLength: token.length,
      matched,
    });
  }

  if (!secret) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (!matched) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Build the Vapi results envelope. `result` is always serialized to a string, as
 * the current Vapi contract requires, and echoes the originating toolCallId.
 */
export function vapiEnvelope(name: string, toolCallId: string, result: unknown): NextResponse {
  return NextResponse.json({
    results: [
      {
        name,
        toolCallId,
        result: typeof result === "string" ? result : JSON.stringify(result),
      },
    ],
  });
}
