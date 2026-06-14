import { describe, it, expect } from "vitest";
import { mockEmbed, cosine, embed } from "@/lib/embeddings";
import { EMBEDDING_DIM } from "@/lib/types";

describe("embeddings", () => {
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
    const v = await embed("hello", { query: true });
    expect(v.length).toBe(EMBEDDING_DIM);
  });
});
