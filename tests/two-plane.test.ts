import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

describe("two-plane guard", () => {
  it("no /scripts or /n8n import appears in /app or /lib", () => {
    const files = [...walk("app"), ...walk("lib")];
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return (
        /from\s+["'](@\/)?(scripts|n8n)\//.test(src) ||
        /import\(\s*["'](@\/)?(scripts|n8n)\//.test(src)
      );
    });
    expect(offenders).toEqual([]);
  });
});
