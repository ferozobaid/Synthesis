/**
 * Claude streaming client + model config. Single switch: Haiku default, Sonnet demo
 * (see /lib/config). Low temperature for deterministic scoring. Falls back to mocks
 * when ANTHROPIC_API_KEY is absent so dev/test run with no credentials.
 *
 * Model notes (verified against the claude-api reference):
 *  - claude-haiku-4-5 / claude-sonnet-4-6 take `temperature`; we do NOT send
 *    `thinking`/`effort` (Haiku 4.5 does not support adaptive thinking / effort).
 *  - Streaming uses messages.stream(); we surface text deltas as a web ReadableStream
 *    for Next.js route handlers.
 */
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { activeModel, useMocks } from "@/lib/config";
import { mockComplete, mockStream } from "@/lib/__mocks__/claude";

export type CompleteOutputSchema = Record<string, unknown> & { type: "object" };

export interface CompleteOpts {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  /** Optional native Claude JSON-schema output constraint. */
  outputSchema?: CompleteOutputSchema;
  /** Optional per-request controls. Existing callers retain SDK defaults. */
  timeoutMs?: number;
  maxRetries?: number;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return _client;
}

/** Non-streaming completion → concatenated text. Used for scoring / structured parse. */
export async function complete(prompt: string, opts: CompleteOpts = {}): Promise<string> {
  if (useMocks()) return mockComplete(prompt, opts);
  const model = opts.model ?? activeModel();
  // The GA helper rewrites unsupported JSON Schema constraints into the subset
  // accepted by Anthropic before the request is serialized.
  const outputFormat = opts.outputSchema
    ? jsonSchemaOutputFormat(opts.outputSchema)
    : null;
  const res = await client().messages.create(
    {
      model,
      max_tokens: opts.maxTokens ?? 1500,
      temperature: opts.temperature ?? 0,
      system: opts.system,
      messages: [{ role: "user", content: prompt }],
      ...(outputFormat
        ? {
            output_config: {
              format: {
                type: outputFormat.type,
                schema: outputFormat.schema,
              },
            },
          }
        : {}),
    },
    {
      ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    },
  );
  // Opt-in real-mode usage logging for cost/verification. Off by default; never reached
  // in mock mode (returns above). No effect on the response shape. See SYNTHESIS_LOG_USAGE.
  if (process.env.SYNTHESIS_LOG_USAGE === "true") {
    console.error(
      `[synthesis usage] model=${model} input_tokens=${res.usage.input_tokens} output_tokens=${res.usage.output_tokens}`,
    );
  }
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** Streaming completion → web ReadableStream of UTF-8 text (for route handlers). */
export function stream(prompt: string, opts: CompleteOpts = {}): ReadableStream<Uint8Array> {
  if (useMocks()) return mockStream(prompt, opts);
  const s = client().messages.stream({
    model: opts.model ?? activeModel(),
    max_tokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0,
    system: opts.system,
    messages: [{ role: "user", content: prompt }],
  });
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      s.on("text", (t: string) => controller.enqueue(enc.encode(t)));
      try {
        await s.finalMessage();
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/** Pull a JSON object out of a (possibly fenced) model response. */
export function extractJSON<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
