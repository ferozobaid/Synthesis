import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pdfText: "PDF resume text",
  docxText: "DOCX job description text",
  getDocumentProxy: vi.fn(),
  pdfExtractText: vi.fn(),
  docxExtractText: vi.fn(),
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: mocks.getDocumentProxy,
  extractText: mocks.pdfExtractText,
}));

vi.mock("mammoth", () => ({
  extractRawText: mocks.docxExtractText,
}));

import {
  DocumentExtractionError,
  MAX_DOCUMENT_BYTES,
  documentKind,
  extractDocumentText,
  validateDocumentMetadata,
  validateDocumentSignature,
} from "@/lib/document-extractor";

beforeEach(() => {
  mocks.getDocumentProxy.mockReset().mockResolvedValue({ numPages: 1 });
  mocks.pdfExtractText.mockReset().mockImplementation(async () => ({ text: mocks.pdfText }));
  mocks.docxExtractText.mockReset().mockImplementation(async () => ({ value: mocks.docxText }));
  mocks.pdfText = "PDF resume text";
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

  it("returns a scanned-PDF-friendly error when no text is extracted", async () => {
    mocks.pdfText = "";
    await expect(
      extractDocumentText(new TextEncoder().encode("%PDF-fake"), "pdf"),
    ).rejects.toMatchObject({ code: "no_extractable_text", status: 422 });
  });
});
