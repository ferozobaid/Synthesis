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
    vi.spyOn(console, "error").mockImplementation(() => {});
    restoreEmbeddingLoader = setEmbeddingLoaderForTests(async () => {
      throw new Error("missing model");
    });

    await expect(embedBatchStrict(["hello"])).rejects.toMatchObject({ category: "load" });
  });

  it("embedBatchStrict categorizes BGE inference failures", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    restoreEmbeddingLoader = setEmbeddingLoaderForTests(async () => async () => {
      throw new Error("bad tensor");
    });

    await expect(embedBatchStrict(["hello"])).rejects.toMatchObject({ category: "inference" });
  });

  it("embedBatchStrict bounds concurrent model inference", async () => {
    const previous = process.env.BGE_INFERENCE_CONCURRENCY;
    process.env.BGE_INFERENCE_CONCURRENCY = "2";
    vi.spyOn(console, "info").mockImplementation(() => {});
    let active = 0;
    let peak = 0;
    restoreEmbeddingLoader = setEmbeddingLoaderForTests(async () => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { data: new Float32Array(EMBEDDING_DIM) };
    });

    try {
      const embeddings = await embedBatchStrict(["a", "b", "c", "d", "e"]);
      expect(embeddings).toHaveLength(5);
      expect(peak).toBe(2);
    } finally {
      if (previous === undefined) delete process.env.BGE_INFERENCE_CONCURRENCY;
      else process.env.BGE_INFERENCE_CONCURRENCY = previous;
    }
  });

  it.runIf(process.env.RUN_BGE_INTEGRATION === "true")(
    "loads the packaged BGE model and returns meaningful normalized vectors",
    async () => {
      const relatedA = await embedBatchStrict(["SQL and Python data analysis"]);
      const relatedB = await embedBatchStrict(["SQL and Python analytics"]);
      const unrelated = await embedBatchStrict(["restaurant pastry cooking"]);
      const norm = Math.sqrt(relatedA[0].reduce((sum, value) => sum + value * value, 0));

      expect(relatedA[0]).toHaveLength(EMBEDDING_DIM);
      expect(norm).toBeCloseTo(1, 5);
      expect(cosine(relatedA[0], relatedB[0])).toBeGreaterThan(
        cosine(relatedA[0], unrelated[0]),
      );
    },
    120_000,
  );
});
