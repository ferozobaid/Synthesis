/**
 * Server-only document text extraction shared by resume and job-description
 * uploads. Files are processed in memory and are never persisted.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type DocumentKind = "pdf" | "docx" | "txt";

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

export async function extractDocumentText(
  buffer: Uint8Array,
  kind: DocumentKind,
): Promise<string> {
  try {
    let text: string;
    if (kind === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(buffer);
      const result = await extractText(pdf, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
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

