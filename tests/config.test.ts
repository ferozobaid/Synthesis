import { afterEach, describe, expect, it } from "vitest";
import { useMocks } from "@/lib/config";

const originalUseMocks = process.env.SYNTHESIS_USE_MOCKS;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (originalUseMocks === undefined) delete process.env.SYNTHESIS_USE_MOCKS;
  else process.env.SYNTHESIS_USE_MOCKS = originalUseMocks;

  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
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
