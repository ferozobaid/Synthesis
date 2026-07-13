import { describe, it, expect } from "vitest";
import {
  cleanResumeText,
  stripLeadingTitleLine,
  extractSkills,
  extractName,
  extractSummary,
  parseResume,
} from "@/lib/parsers/resume-parser";
import { parseJD } from "@/lib/parsers/jd-parser";

describe("resume parser — EDA cleaning", () => {
  it("drops the 'Company Name' privacy placeholder", () => {
    expect(cleanResumeText("Worked at Company Name as an analyst")).not.toContain("Company Name");
  });

  it("normalizes the full-width dash (U+FF0D)", () => {
    expect(cleanResumeText("2019－2021")).toContain("2019-2021");
  });

  it("strips a leading ALL-CAPS title line (defeats label leakage)", () => {
    expect(stripLeadingTitleLine("INFORMATION TECHNOLOGY\nJane Doe")).not.toMatch(/^INFORMATION TECHNOLOGY/);
  });

  it("extracts known skills", () => {
    const skills = extractSkills("Built pipelines in SQL and Python with Power BI");
    expect(skills).toEqual(expect.arrayContaining(["sql", "python", "power bi"]));
  });

  it("parseResume returns cleaned raw_text and skills", () => {
    const p = parseResume("DATA ANALYST\nSkills: SQL, Python\nExperience\n- did things in SQL across regions");
    expect(p.skills.length).toBeGreaterThan(0);
    expect(p.raw_text).not.toMatch(/^DATA ANALYST/);
  });

  it("extracts a likely name without treating leaked category titles as names", () => {
    expect(extractName("JANE DOE\njane@example.com\nExperience")).toBe("Jane Doe");
    expect(extractName("INFORMATION TECHNOLOGY\nJane Doe\nExperience")).toBe("Jane Doe");
  });

  it("extracts a summary section", () => {
    const summary = extractSummary(
      "Jane Doe\nSummary\nAnalytics leader with SQL, Python, and financial modeling experience.\nExperience\nAnalyst",
    );
    expect(summary).toMatch(/Analytics leader/);
  });
});

describe("jd parser", () => {
  it("reads company/title headers and classifies requirements", () => {
    const jd = parseJD(
      "Title: Data Analyst\nCompany: Acme\nRequired: strong SQL and Python. A Bachelor's degree is required. Experience with finance is a plus.",
    );
    expect(jd.company).toBe("Acme");
    expect(jd.role_title).toBe("Data Analyst");
    expect(jd.must_have.length).toBeGreaterThan(0);
    expect(jd.nice_to_have.some((r) => /plus/i.test(r.text))).toBe(true);
  });

  it("extracts requirements from real posting skill-section phrasing", () => {
    const jd = parseJD(`Title: Salesforce Vlocity Developer
Company: Client
Role: Application developer
Must have Skills 5 years of Salesforce Vlocity implementation experience.
Skills Require: Java, Microservices, Rest Api, Web services, React JS, Typescript.`);
    const text = jd.must_have.map((r) => r.text).join(" ");
    expect(jd.years_experience).toBe(5);
    expect(jd.must_have.length).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/Java/);
    expect(text).toMatch(/Typescript/i);
    expect(jd.must_have.map((r) => r.onet_skill)).toEqual(expect.arrayContaining(["Java"]));
  });

  it("extracts action-oriented responsibilities and qualifications", () => {
    const jd = parseJD(`Title: Backend Java Developer
Company: Platform Co
Responsibilities: Develop new product features and build REST APIs in Java.
Qualifications: Experience with Java/J2EE, Spring Framework, and data structures.`);
    const text = jd.must_have.map((r) => r.text).join(" ");
    expect(jd.must_have.length).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/Develop new product features/);
    expect(text).toMatch(/Java\/J2EE/);
    expect(jd.must_have.map((r) => r.onet_skill)).toEqual(expect.arrayContaining(["Java"]));
  });

  it("keeps Education headers as education requirements", () => {
    const jd = parseJD(`Title: Software Engineer
Company: Platform Co
Education: Bachelor's degree in Computer Science or related field required.
Required: Java and cloud computing experience.`);
    const edu = jd.must_have.find((r) => r.category === "education");
    expect(jd.education).toMatch(/Bachelor/);
    expect(edu?.text).toMatch(/Bachelor/);
  });
});

const STRUCT_RESUME = `JANE DOE
Business Analytics

EXPERIENCE
Commercial Analyst, Retail Co
- Built outlet-level reporting in SQL across 4 regions
- Automated monthly analysis in Python (pandas)
- Designed Power BI dashboards used in sales reviews

EDUCATION
BSc, Business Analytics`;

describe("resume parser — structured extraction", () => {
  it("normalizes skills to canonical O*NET forms (not lowercase)", () => {
    const p = parseResume(STRUCT_RESUME);
    expect(p.skills).toEqual(expect.arrayContaining(["SQL", "Python", "Power BI"]));
    expect(p.skills).not.toContain("sql");
  });

  it("returns parsed name and summary when present", () => {
    const p = parseResume(`JANE DOE
Summary
Analytics professional with SQL and Python experience across retail teams.

${STRUCT_RESUME}`);
    expect(p.name).toBe("Jane Doe");
    expect(p.summary).toMatch(/Analytics professional/);
  });

  it("structures experience into entries with role / org / bullets", () => {
    const e = parseResume(STRUCT_RESUME).experience[0];
    expect(e.title).toBe("Commercial Analyst");
    expect(e.org).toBe("Retail Co");
    expect(e.bullets.length).toBeGreaterThanOrEqual(2);
  });

  it("does not bleed the education section into experience bullets", () => {
    const p = parseResume(STRUCT_RESUME);
    expect(p.experience.flatMap((e) => e.bullets).join(" ")).not.toMatch(/BSc/);
    expect(p.education[0].degree).toMatch(/BSc/);
  });
});

const STRUCT_JD = `Title: Data Analyst
Company: Tenazx Inc

We are hiring a Data Analyst. Required: strong SQL and Python or R; experience with
data visualization tools; statistical analysis. A Bachelor's degree in a quantitative
field is required. Experience with cybersecurity or financial services is a plus.`;

describe("jd parser — O*NET grounding & segmentation", () => {
  it("grounds requirements with a canonical onet_skill", () => {
    const skills = parseJD(STRUCT_JD).must_have.map((r) => r.onet_skill);
    expect(skills).toEqual(expect.arrayContaining(["SQL", "Data Visualization", "Statistics"]));
  });

  it("reflows wrapped prose and drops boilerplate / header lines", () => {
    const jd = parseJD(STRUCT_JD);
    const all = [...jd.must_have, ...jd.nice_to_have];
    expect(jd.must_have.some((r) => /data visualization tools/i.test(r.text))).toBe(true);
    expect(all.some((r) => /we are hiring/i.test(r.text))).toBe(false);
    expect(all.some((r) => /^Title:/i.test(r.text))).toBe(false);
  });

  it("fills the domain from the taxonomy", () => {
    expect(parseJD(STRUCT_JD).domain).toBe("Finance");
  });
});
