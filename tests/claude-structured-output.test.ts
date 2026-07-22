import { beforeEach, describe, expect, it, vi } from "vitest";

const { messagesCreateMock } = vi.hoisted(() => ({
  messagesCreateMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: messagesCreateMock };
  },
}));

vi.mock("@/lib/config", () => ({
  activeModel: () => "claude-haiku-4-5-20251001",
  useMocks: () => false,
}));

import { complete } from "@/lib/claude";
import {
  CASE_INTERVIEWER_MAX_RETRIES,
  CASE_INTERVIEWER_MAX_TOKENS,
  CASE_INTERVIEWER_MODEL,
  CASE_INTERVIEWER_SCHEMA,
  CASE_INTERVIEWER_TIMEOUT_MS,
} from "@/lib/voice/case-interviewer";

const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "uniqueItems",
  "nullable",
  "oneOf",
  "default",
  "examples",
]);

function visitSchema(value: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => visitSchema(item, visitor));
    return;
  }
  const record = value as Record<string, unknown>;
  visitor(record);
  Object.values(record).forEach((child) => visitSchema(child, visitor));
}

describe("Anthropic GA structured-output request", () => {
  beforeEach(() => {
    messagesCreateMock.mockReset();
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "{\"ok\":true}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });

  it("uses messages.create with output_config.format and an Anthropic-compatible schema", async () => {
    const response = await complete("safe test prompt", {
      system: "safe test system",
      model: CASE_INTERVIEWER_MODEL,
      maxTokens: CASE_INTERVIEWER_MAX_TOKENS,
      temperature: 0,
      outputSchema: CASE_INTERVIEWER_SCHEMA,
      timeoutMs: CASE_INTERVIEWER_TIMEOUT_MS,
      maxRetries: CASE_INTERVIEWER_MAX_RETRIES,
    });

    expect(response).toBe('{"ok":true}');
    expect(messagesCreateMock).toHaveBeenCalledTimes(1);
    const [request, requestOptions] = messagesCreateMock.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(request).toMatchObject({
      model: CASE_INTERVIEWER_MODEL,
      max_tokens: CASE_INTERVIEWER_MAX_TOKENS,
      temperature: 0,
      output_config: {
        format: {
          type: "json_schema",
        },
      },
    });
    expect(request).not.toHaveProperty("output_format");
    expect(request).not.toHaveProperty("betas");
    expect(requestOptions).toEqual({
      timeout: CASE_INTERVIEWER_TIMEOUT_MS,
      maxRetries: CASE_INTERVIEWER_MAX_RETRIES,
    });

    const outputConfig = request.output_config as {
      format: { type: string; schema: Record<string, unknown> };
    };
    expect(Object.keys(outputConfig.format).sort()).toEqual(["schema", "type"]);
    visitSchema(outputConfig.format.schema, (schema) => {
      for (const keyword of UNSUPPORTED_SCHEMA_KEYWORDS) {
        expect(schema).not.toHaveProperty(keyword);
      }
      if (schema.type === "object") {
        expect(schema.additionalProperties).toBe(false);
      }
    });
  });
});
