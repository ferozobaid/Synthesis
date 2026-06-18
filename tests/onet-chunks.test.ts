import { describe, it, expect } from "vitest";
import { mockOnetChunks } from "@/lib/__mocks__/fixtures";

const TYPES = new Set(["skill", "task", "tool", "knowledge", "description"]);

describe("onet chunks fixture", () => {
  it("returns a non-empty set", () => {
    expect(mockOnetChunks().length).toBeGreaterThan(0);
  });

  it("is deterministic across calls", () => {
    expect(mockOnetChunks()).toEqual(mockOnetChunks());
  });

  it("every chunk has a valid content_type and non-empty fields", () => {
    for (const c of mockOnetChunks()) {
      expect(TYPES.has(c.content_type)).toBe(true);
      expect(c.content.trim().length).toBeGreaterThan(0);
      expect(c.soc).toBeTruthy();
      expect(c.occupation_title).toBeTruthy();
    }
  });

  it("covers at least three content types", () => {
    expect(new Set(mockOnetChunks().map((c) => c.content_type)).size).toBeGreaterThanOrEqual(3);
  });
});
