import { afterEach, describe, it, expect, vi } from "vitest";
import {
  mockEmbed,
  cosine,
  embed,
  embedBatchStrict,
  setEmbeddingLoaderForTests,
} from "@/lib/embeddings";
import { EMBEDDING_DIM } from "@/lib/types";

describe("embeddings", () => {
  let restoreEmbeddingLoader: (() => void) | null = null;

  afterEach(() => {
    restoreEmbeddingLoader?.();
    restoreEmbeddingLoader = null;
    vi.restoreAllMocks();
  });

  it("mockEmbed is deterministic, 384-dim, and L2-normalized", () => {
    const a = mockEmbed("hello world");
    const b = mockEmbed("hello world");
    expect(a.length).toBe(EMBEDDING_DIM);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("cosine self-similarity is 1; unrelated text is lower", () => {
    const a = mockEmbed("data analyst sql python");
    const same = mockEmbed("data analyst sql python");
    const other = mockEmbed("chef cooking restaurant kitchen");
    expect(cosine(a, same)).toBeCloseTo(1, 5);
    expect(cosine(a, other)).toBeLessThan(1);
  });

  it("embed() falls back to the mock vector when disabled", async () => {
    const prev = process.env.EMBEDDINGS_ENABLED;
    process.env.EMBEDDINGS_ENABLED = "false";
    try {
      const v = await embed("hello", { query: true });
      expect(v.length).toBe(EMBEDDING_DIM);
    } finally {
      if (prev === undefined) delete process.env.EMBEDDINGS_ENABLED;
      else process.env.EMBEDDINGS_ENABLED = prev;
    }
  });

  it("embedBatchStrict uses the configured extractor without falling back to mock vectors", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    restoreEmbeddingLoader = setEmbeddingLoaderForTests(async () => async () => {
      const data = new Float32Array(EMBEDDING_DIM);
      data[0] = 1;
      return { data };
    });

    const [v] = await embedBatchStrict(["hello"], { query: true });

    expect(v).toEqual([1, ...new Array<number>(EMBEDDING_DIM - 1).fill(0)]);
    expect(v).not.toEqual(mockEmbed("hello"));
  });

  it("embedBatchStrict categorizes BGE load failures", async () => {
    restoreEmbeddingLoader = setEmbeddingLoaderForTests(async () => {
      throw new Error("missing model");
    });

    await expect(embedBatchStrict(["hello"])).rejects.toMatchObject({ category: "load" });
  });

  it("embedBatchStrict categorizes BGE inference failures", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    restoreEmbeddingLoader = setEmbeddingLoaderForTests(async () => async () => {
      throw new Error("bad tensor");
    });

    await expect(embedBatchStrict(["hello"])).rejects.toMatchObject({ category: "inference" });
  });
});
