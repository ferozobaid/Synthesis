/**
 * Server-only document text extraction shared by resume and job-description
 * uploads. Files are processed in memory and are never persisted.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type DocumentKind = "pdf" | "docx" | "txt";

export interface PDFTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  hasEOL: boolean;
}

export class DocumentExtractionError extends Error {
  constructor(
    public readonly code:
      | "unsupported_type"
      | "file_too_large"
      | "invalid_file"
      | "no_extractable_text"
      | "extraction_failed",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}

const MIME_TYPES: Record<DocumentKind, Set<string>> = {
  pdf: new Set(["application/pdf", "application/octet-stream", ""]),
  docx: new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
    "application/octet-stream",
    "",
  ]),
  txt: new Set(["text/plain", "application/octet-stream", ""]),
};

export function documentKind(filename: string): DocumentKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".txt")) return "txt";
  return null;
}

export function validateDocumentMetadata(file: {
  name: string;
  size: number;
  type?: string;
}): DocumentKind {
  const kind = documentKind(file.name);
  if (!kind || !MIME_TYPES[kind].has((file.type ?? "").toLowerCase())) {
    throw new DocumentExtractionError(
      "unsupported_type",
      "Upload a PDF, DOCX, or TXT file.",
      415,
    );
  }
  if (file.size <= 0) {
    throw new DocumentExtractionError("invalid_file", "The selected file is empty.", 400);
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentExtractionError(
      "file_too_large",
      "The selected file is larger than 10 MB.",
      413,
    );
  }
  return kind;
}

export function validateDocumentSignature(buffer: Uint8Array, kind: DocumentKind): void {
  if (kind === "pdf") {
    const signature = new TextDecoder().decode(buffer.slice(0, 5));
    if (signature !== "%PDF-") {
      throw new DocumentExtractionError(
        "invalid_file",
        "This file does not appear to be a valid PDF.",
        400,
      );
    }
  }
  if (kind === "docx" && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    throw new DocumentExtractionError(
      "invalid_file",
      "This file does not appear to be a valid DOCX document.",
      400,
    );
  }
}

interface PDFVisualLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

function visualLineBreakBetween(previous: PDFTextItem, current: PDFTextItem): boolean {
  if (previous.hasEOL) return true;

  const referenceSize = Math.max(
    1,
    Math.min(
      previous.fontSize || previous.height || 1,
      current.fontSize || current.height || 1,
    ),
  );
  const yTolerance = Math.max(1.5, referenceSize * 0.35);
  if (Math.abs(current.y - previous.y) > yTolerance) return true;

  // A reset to the left or a column-sized horizontal gap generally signals a
  // new visual line even when the PDF omitted hasEOL metadata.
  if (current.x < previous.x - Math.max(2, referenceSize * 0.5)) return true;
  const horizontalGap = current.x - (previous.x + previous.width);
  return horizontalGap > Math.max(36, referenceSize * 3);
}

function needsSpaceBetween(previous: PDFTextItem, current: PDFTextItem): boolean {
  if (/\s$/.test(previous.str) || /^\s/.test(current.str)) return true;
  const referenceSize = Math.max(previous.fontSize, current.fontSize, 1);
  const horizontalGap = current.x - (previous.x + previous.width);
  return horizontalGap > Math.max(0.5, referenceSize * 0.08);
}

function buildVisualLines(items: PDFTextItem[]): PDFVisualLine[] {
  const lines: PDFVisualLine[] = [];
  let current: PDFTextItem[] = [];
  let previous: PDFTextItem | null = null;

  function flush() {
    if (!current.length) return;
    let text = "";
    for (let index = 0; index < current.length; index += 1) {
      const item = current[index];
      const value = item.str.replace(/\s+/g, " ").trim();
      if (!value) continue;
      if (index > 0 && needsSpaceBetween(current[index - 1], item)) text += " ";
      text += value;
    }
    if (text) {
      const left = Math.min(...current.map((item) => item.x));
      const right = Math.max(...current.map((item) => item.x + item.width));
      lines.push({
        text,
        x: left,
        y: current[0].y,
        width: Math.max(0, right - left),
        height: Math.max(...current.map((item) => item.height), 1),
        fontSize: Math.max(...current.map((item) => item.fontSize), 1),
      });
    }
    current = [];
    previous = null;
  }

  for (const item of items) {
    const value = item.str.replace(/\s+/g, " ").trim();
    if (!value) {
      if (item.hasEOL) flush();
      continue;
    }
    if (previous && visualLineBreakBetween(previous, item)) flush();
    current.push(item);
    previous = item;
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

const SECTION_HEADING = /^(?:professional\s+)?(?:summary|profile|objective|experience|employment|education|skills|competencies|certifications?|projects?|awards?|languages?|interests?|references?)\s*:?$/i;
const BULLET_LINE = /^(?:[-*•▪●‣·]|\d+[.)])\s+/;

function isHeading(line: PDFVisualLine): boolean {
  if (SECTION_HEADING.test(line.text)) return true;
  const letters = line.text.replace(/[^A-Za-z]/g, "");
  return (
    letters.length >= 3 &&
    line.text.length <= 80 &&
    line.text.split(/\s+/).length <= 8 &&
    letters === letters.toUpperCase()
  );
}

function startsLogicalParagraph(previous: PDFVisualLine, current: PDFVisualLine): boolean {
  if (isHeading(previous) || isHeading(current)) return true;
  if (BULLET_LINE.test(current.text)) return true;

  const smallerFont = Math.max(1, Math.min(previous.fontSize, current.fontSize));
  if (Math.abs(previous.fontSize - current.fontSize) > Math.max(1.5, smallerFont * 0.18)) {
    return true;
  }

  const lineHeight = Math.max(
    previous.height,
    current.height,
    previous.fontSize,
    current.fontSize,
    1,
  );
  if (Math.abs(current.y - previous.y) > lineHeight * 1.65) return true;

  const indentation = current.x - previous.x;
  const indentationTolerance = Math.max(8, smallerFont * 1.2);
  if (Math.abs(indentation) > indentationTolerance) {
    // Wrapped bullet text commonly uses a hanging indent.
    if (BULLET_LINE.test(previous.text) && indentation > 0) return false;
    return true;
  }

  return false;
}

function joinWrappedLine(previousText: string, currentText: string): string {
  if (/[A-Za-z]-$/.test(previousText) && /^[a-z]/.test(currentText)) {
    return `${previousText.slice(0, -1)}${currentText}`;
  }
  return `${previousText} ${currentText}`;
}

function mergeVisualLines(lines: PDFVisualLine[]): string {
  if (!lines.length) return "";
  const paragraphs: string[] = [];
  let paragraph = lines[0].text;

  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    if (startsLogicalParagraph(previous, current)) {
      paragraphs.push(paragraph);
      paragraph = current.text;
    } else {
      paragraph = joinWrappedLine(paragraph, current.text);
    }
  }
  paragraphs.push(paragraph);
  return paragraphs.join("\n");
}

/** Reconstruct logical paragraphs from PDF.js visual text rows. */
export function reconstructPDFText(pages: PDFTextItem[][]): string {
  return pages
    .map((items) => mergeVisualLines(buildVisualLines(items)))
    .filter(Boolean)
    .join("\n\n");
}

export async function extractDocumentText(
  buffer: Uint8Array,
  kind: DocumentKind,
): Promise<string> {
  try {
    let text: string;
    if (kind === "pdf") {
      const { extractTextItems, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(buffer);
      const result = await extractTextItems(pdf);
      text = reconstructPDFText(result.items);
    } else if (kind === "docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      text = result.value;
    } else {
      text = new TextDecoder().decode(buffer);
    }

    const normalized = text.replace(/\r\n?/g, "\n").trim();
    if (!normalized) {
      throw new DocumentExtractionError(
        "no_extractable_text",
        kind === "pdf"
          ? "No selectable text was found. This may be a scanned PDF; paste the text manually instead."
          : "No text could be extracted from this document.",
        422,
      );
    }
    return normalized;
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError(
      "extraction_failed",
      "We could not read this document. Try another file or paste the text manually.",
      422,
    );
  }
}
