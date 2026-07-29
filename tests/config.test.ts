import { afterEach, describe, expect, it } from "vitest";
import { embeddingsModelRevision, useMocks } from "@/lib/config";

const originalUseMocks = process.env.SYNTHESIS_USE_MOCKS;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalEmbeddingRevision = process.env.EMBEDDINGS_MODEL_REVISION;

afterEach(() => {
  if (originalUseMocks === undefined) delete process.env.SYNTHESIS_USE_MOCKS;
  else process.env.SYNTHESIS_USE_MOCKS = originalUseMocks;

  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;

  if (originalEmbeddingRevision === undefined) delete process.env.EMBEDDINGS_MODEL_REVISION;
  else process.env.EMBEDDINGS_MODEL_REVISION = originalEmbeddingRevision;
});

describe("embeddingsModelRevision", () => {
  it("uses the pinned default and honours an explicit revision", () => {
    delete process.env.EMBEDDINGS_MODEL_REVISION;
    expect(embeddingsModelRevision()).toBe(
      "ea104dacec62c0de699686887e3f920caeb4f3e3",
    );

    process.env.EMBEDDINGS_MODEL_REVISION = "test-revision";
    expect(embeddingsModelRevision()).toBe("test-revision");
  });
});

describe("useMocks", () => {
  it("uses mocks automatically when the Claude credential is absent", () => {
    delete process.env.SYNTHESIS_USE_MOCKS;
    delete process.env.ANTHROPIC_API_KEY;

    expect(useMocks()).toBe(true);
  });

  it("uses real mode automatically when the Claude credential is present", () => {
    delete process.env.SYNTHESIS_USE_MOCKS;
    process.env.ANTHROPIC_API_KEY = "test-key";

    expect(useMocks()).toBe(false);
  });

  it("honours an explicit mock-mode override", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.SYNTHESIS_USE_MOCKS = "true";
    expect(useMocks()).toBe(true);

    delete process.env.ANTHROPIC_API_KEY;
    process.env.SYNTHESIS_USE_MOCKS = "false";
    expect(useMocks()).toBe(false);
  });
});
