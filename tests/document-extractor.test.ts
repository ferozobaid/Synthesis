import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pdfItems: [] as Array<Array<{
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    hasEOL: boolean;
  }>>,
  docxText: "DOCX job description text",
  getDocumentProxy: vi.fn(),
  pdfExtractTextItems: vi.fn(),
  docxExtractText: vi.fn(),
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: mocks.getDocumentProxy,
  extractTextItems: mocks.pdfExtractTextItems,
}));

vi.mock("mammoth", () => ({
  extractRawText: mocks.docxExtractText,
}));

import {
  DocumentExtractionError,
  MAX_DOCUMENT_BYTES,
  documentKind,
  extractDocumentText,
  reconstructPDFText,
  validateDocumentMetadata,
  validateDocumentSignature,
} from "@/lib/document-extractor";

beforeEach(() => {
  mocks.getDocumentProxy.mockReset().mockResolvedValue({ numPages: 1 });
  mocks.pdfItems = [
    [
      { str: "PDF resume", x: 72, y: 720, width: 80, height: 12, fontSize: 12, hasEOL: true },
      { str: "text", x: 72, y: 706, width: 20, height: 12, fontSize: 12, hasEOL: false },
    ],
  ];
  mocks.pdfExtractTextItems
    .mockReset()
    .mockImplementation(async () => ({ items: mocks.pdfItems, totalPages: mocks.pdfItems.length }));
  mocks.docxExtractText.mockReset().mockImplementation(async () => ({ value: mocks.docxText }));
  mocks.docxText = "DOCX job description text";
});

describe("document extraction", () => {
  it("recognizes only supported document extensions", () => {
    expect(documentKind("resume.PDF")).toBe("pdf");
    expect(documentKind("resume.docx")).toBe("docx");
    expect(documentKind("posting.txt")).toBe("txt");
    expect(documentKind("resume.doc")).toBeNull();
  });

  it("rejects unsupported, empty, and oversized uploads", () => {
    expect(() => validateDocumentMetadata({ name: "resume.doc", size: 20 })).toThrow(
      DocumentExtractionError,
    );
    expect(() => validateDocumentMetadata({ name: "resume.pdf", size: 0 })).toThrow(
      expect.objectContaining({ code: "invalid_file", status: 400 }),
    );
    expect(() =>
      validateDocumentMetadata({ name: "resume.pdf", size: MAX_DOCUMENT_BYTES + 1 }),
    ).toThrow(expect.objectContaining({ code: "file_too_large", status: 413 }));
  });

  it("checks PDF and DOCX signatures", () => {
    expect(() =>
      validateDocumentSignature(new TextEncoder().encode("not a pdf"), "pdf"),
    ).toThrow(expect.objectContaining({ code: "invalid_file" }));
    expect(() => validateDocumentSignature(Uint8Array.from([0, 1, 2]), "docx")).toThrow(
      expect.objectContaining({ code: "invalid_file" }),
    );
    expect(() =>
      validateDocumentSignature(new TextEncoder().encode("%PDF-1.7"), "pdf"),
    ).not.toThrow();
    expect(() =>
      validateDocumentSignature(Uint8Array.from([0x50, 0x4b, 3, 4]), "docx"),
    ).not.toThrow();
  });

  it("extracts and normalizes PDF, DOCX, and TXT text", async () => {
    expect(await extractDocumentText(new TextEncoder().encode("%PDF-fake"), "pdf")).toBe(
      "PDF resume text",
    );
    expect(await extractDocumentText(Uint8Array.from([0x50, 0x4b]), "docx")).toBe(
      "DOCX job description text",
    );
    expect(await extractDocumentText(new TextEncoder().encode(" line one\r\nline two "), "txt")).toBe(
      "line one\nline two",
    );
  });

  it("reconstructs PDF lines from coordinates when hasEOL is absent", () => {
    expect(
      reconstructPDFText([
        [
          { str: "EXPERIENCE", x: 72, y: 720, width: 75, height: 12, fontSize: 12, hasEOL: false },
          { str: "Data", x: 72, y: 695, width: 25, height: 10, fontSize: 10, hasEOL: false },
          { str: "Analyst", x: 101, y: 695, width: 36, height: 10, fontSize: 10, hasEOL: false },
          { str: "- Built SQL dashboards", x: 72, y: 682, width: 100, height: 10, fontSize: 10, hasEOL: false },
        ],
      ]),
    ).toBe("EXPERIENCE\nData Analyst\n- Built SQL dashboards");
  });

  it("joins visual rows that belong to one wrapped paragraph", () => {
    expect(
      reconstructPDFText([
        [
          { str: "Commercial analyst who turns complex", x: 72, y: 720, width: 210, height: 10, fontSize: 10, hasEOL: true },
          { str: "datasets into clear recommendations for", x: 72, y: 708, width: 205, height: 10, fontSize: 10, hasEOL: true },
          { str: "senior stakeholders.", x: 72, y: 696, width: 105, height: 10, fontSize: 10, hasEOL: false },
        ],
      ]),
    ).toBe(
      "Commercial analyst who turns complex datasets into clear recommendations for senior stakeholders.",
    );
  });

  it("keeps bullets and genuinely spaced paragraphs separate", () => {
    expect(
      reconstructPDFText([
        [
          { str: "- Built a forecasting model used by", x: 72, y: 720, width: 190, height: 10, fontSize: 10, hasEOL: true },
          { str: "regional leadership.", x: 82, y: 708, width: 95, height: 10, fontSize: 10, hasEOL: true },
          { str: "- Automated monthly reporting.", x: 72, y: 696, width: 145, height: 10, fontSize: 10, hasEOL: true },
          { str: "Separate profile paragraph.", x: 72, y: 670, width: 130, height: 10, fontSize: 10, hasEOL: false },
        ],
      ]),
    ).toBe(
      "- Built a forecasting model used by regional leadership.\n- Automated monthly reporting.\nSeparate profile paragraph.",
    );
  });

  it("separates pages and large visual columns instead of flattening them", () => {
    expect(
      reconstructPDFText([
        [
          { str: "Skills", x: 72, y: 720, width: 30, height: 10, fontSize: 10, hasEOL: false },
          { str: "Education", x: 300, y: 720, width: 45, height: 10, fontSize: 10, hasEOL: false },
        ],
        [
          { str: "Page two", x: 72, y: 720, width: 45, height: 10, fontSize: 10, hasEOL: false },
        ],
      ]),
    ).toBe("Skills\nEducation\n\nPage two");
  });

  it("does not duplicate line breaks around empty PDF text markers", () => {
    expect(
      reconstructPDFText([
        [
          { str: "SUMMARY", x: 72, y: 720, width: 55, height: 12, fontSize: 12, hasEOL: true },
          { str: "", x: 127, y: 720, width: 0, height: 0, fontSize: 12, hasEOL: true },
          { str: "Analytics professional", x: 72, y: 700, width: 100, height: 10, fontSize: 10, hasEOL: false },
        ],
      ]),
    ).toBe("SUMMARY\nAnalytics professional");
  });

  it("returns a scanned-PDF-friendly error when no text is extracted", async () => {
    mocks.pdfItems = [[]];
    await expect(
      extractDocumentText(new TextEncoder().encode("%PDF-fake"), "pdf"),
    ).rejects.toMatchObject({ code: "no_extractable_text", status: 422 });
  });
});
