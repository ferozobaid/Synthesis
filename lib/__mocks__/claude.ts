/**
 * Low-level Claude mocks — used by /lib/claude.ts when running without credentials.
 * Does not import claude.ts (avoids a cycle); signatures are intentionally loose.
 */

export function mockComplete(prompt: string, _opts: unknown = {}): Promise<string> {
  // A small, JSON-parseable envelope so callers that JSON.parse(...) don't crash.
  return Promise.resolve(
    JSON.stringify({
      mock: true,
      note: "Synthesis mock completion (no ANTHROPIC_API_KEY set).",
      echo: prompt.slice(0, 120),
    }),
  );
}

export function mockStream(_prompt: string, _opts: unknown = {}): ReadableStream<Uint8Array> {
  const text =
    "[mock stream] Synthesis is running without credentials — this is a placeholder streamed response.";
  const enc = new TextEncoder();
  const chunks = text.match(/.{1,16}/g) ?? [text];
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else controller.close();
    },
  });
}
