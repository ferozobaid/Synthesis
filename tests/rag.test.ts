import { describe, it, expect } from "vitest";
import { retrieveAnswer, topK } from "@/lib/rag";
import { mockAnswerBank } from "@/lib/__mocks__/fixtures";
import { mockEmbed } from "@/lib/embeddings";

describe("rag retrieval", () => {
  it("topK ranks by cosine descending", () => {
    const q = mockEmbed("alpha");
    const cands = [
      { item: "a", embedding: mockEmbed("alpha") },
      { item: "b", embedding: mockEmbed("totally different beta gamma") },
    ];
    const r = topK(q, cands, 2);
    expect(r[0].item).toBe("a");
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score);
  });

  it("retrieveAnswer returns k matches from the seed answer bank", async () => {
    const bank = mockAnswerBank();
    expect(bank.length).toBeGreaterThan(0);
    const r = await retrieveAnswer("Tell me about a time you led a team", bank, 1);
    expect(r.length).toBe(1);
    expect(r[0].item.question).toBeTruthy();
  });
});
