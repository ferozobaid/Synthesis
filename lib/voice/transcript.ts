export const VOICE_TRANSCRIPT_MAX_MESSAGES = 400;
export const VOICE_TRANSCRIPT_MAX_MESSAGE_CHARS = 12_000;
export const VOICE_TRANSCRIPT_MAX_TOTAL_CHARS = 120_000;

export interface NormalizedVoiceTranscriptTurn {
  role: "assistant" | "candidate";
  text: string;
  ordinal: number;
}

export interface NormalizeVoiceTranscriptResult {
  turns: NormalizedVoiceTranscriptTurn[];
  truncated: boolean;
}

function textFromMessage(value: Record<string, unknown>): string {
  const raw = typeof value.message === "string"
    ? value.message
    : typeof value.transcript === "string"
      ? value.transcript
      : "";
  return raw.replace(/\s+/g, " ").trim();
}

/** Normalize only artifact.messages. No other webhook field is accepted here. */
export function normalizeVoiceTranscript(messages: unknown): NormalizeVoiceTranscriptResult {
  if (!Array.isArray(messages)) return { turns: [], truncated: false };
  const turns: NormalizedVoiceTranscriptTurn[] = [];
  let totalChars = 0;
  let truncated = messages.length > VOICE_TRANSCRIPT_MAX_MESSAGES;

  for (const raw of messages.slice(0, VOICE_TRANSCRIPT_MAX_MESSAGES)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
    const normalizedRole = role === "assistant" || role === "bot"
      ? "assistant"
      : role === "user" || role === "customer"
        ? "candidate"
        : null;
    if (!normalizedRole) continue;

    let text = textFromMessage(record);
    if (!text) continue;
    if (text.length > VOICE_TRANSCRIPT_MAX_MESSAGE_CHARS) {
      text = text.slice(0, VOICE_TRANSCRIPT_MAX_MESSAGE_CHARS).trim();
      truncated = true;
    }
    const remaining = VOICE_TRANSCRIPT_MAX_TOTAL_CHARS - totalChars;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (text.length > remaining) {
      text = text.slice(0, remaining).trim();
      truncated = true;
    }
    if (!text) break;
    turns.push({ role: normalizedRole, text, ordinal: turns.length });
    totalChars += text.length;
  }

  return { turns, truncated };
}
