import { describe, it, expect } from "vitest";
import {
  normalizeSkill,
  normalizeSkills,
  extractCanonicalSkills,
  matchOccupation,
  relatedSkills,
  getOccupations,
  TAXONOMY_VERSION,
} from "@/lib/onet";

describe("onet taxonomy — loading", () => {
  it("loads the committed O*NET subset", () => {
    expect(TAXONOMY_VERSION).toMatch(/O\*NET/);
    const occ = getOccupations();
    expect(occ.length).toBeGreaterThanOrEqual(15);
    expect(occ.some((o) => o.title === "Data Scientists")).toBe(true);
    expect(occ.some((o) => o.title === "Management Analysts")).toBe(true);
  });

  it("Data Scientists carries core data tools", () => {
    const ds = getOccupations().find((o) => o.soc === "15-2051.00");
    expect(ds?.tools).toEqual(expect.arrayContaining(["Python", "SQL"]));
  });
});

describe("onet — skill normalization", () => {
  it("maps every surface form of SQL to one canonical", () => {
    expect(normalizeSkill("sql")).toBe("SQL");
    expect(normalizeSkill("SQL")).toBe("SQL");
    expect(normalizeSkill("Structured Query Language")).toBe("SQL");
  });

  it("strips vendor prefixes from tool names", () => {
    expect(normalizeSkill("Microsoft Power BI")).toBe("Power BI");
  });

  it("falls back to title-case for unknown skills", () => {
    expect(normalizeSkill("underwater basket weaving")).toBe("Underwater Basket Weaving");
  });

  it("dedupes a normalized list", () => {
    expect(normalizeSkills(["sql", "SQL", "structured query language"])).toEqual(["SQL"]);
  });
});

describe("onet — extraction & occupations", () => {
  it("extracts canonical skills from free text", () => {
    const found = extractCanonicalSkills("Built dashboards in Tableau and wrote PySpark jobs");
    expect(found).toEqual(expect.arrayContaining(["Tableau", "Spark"]));
  });

  it("does not fire single-letter skills inside other words", () => {
    expect(extractCanonicalSkills("Built reporting in Redshift")).not.toContain("R");
  });

  it("maps a JD role title to an occupation", () => {
    expect(matchOccupation("Data Scientist")?.soc).toBe("15-2051.00");
    expect(matchOccupation("there is no such job here")).toBeNull();
  });

  it("relatedSkills links a concept to concrete tools", () => {
    expect(relatedSkills("Data Visualization")).toEqual(expect.arrayContaining(["Tableau", "Power BI"]));
  });
});
