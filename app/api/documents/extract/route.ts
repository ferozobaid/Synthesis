import { NextRequest, NextResponse } from "next/server";
import {
  DocumentExtractionError,
  extractDocumentText,
  validateDocumentMetadata,
  validateDocumentSignature,
} from "@/lib/document-extractor";

export const runtime = "nodejs";

function errorResponse(error: DocumentExtractionError) {
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: error.status },
  );
}

// Extracts one PDF, DOCX, or TXT file in memory. Nothing is persisted.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const candidate = form.get("file");
    if (
      !candidate ||
      typeof candidate === "string" ||
      typeof candidate.arrayBuffer !== "function"
    ) {
      return errorResponse(
        new DocumentExtractionError("invalid_file", "Choose a document to upload.", 400),
      );
    }

    const kind = validateDocumentMetadata(candidate);
    const buffer = new Uint8Array(await candidate.arrayBuffer());
    validateDocumentSignature(buffer, kind);
    const text = await extractDocumentText(buffer, kind);

    return NextResponse.json({ text, filename: candidate.name, kind });
  } catch (error) {
    if (error instanceof DocumentExtractionError) return errorResponse(error);
    return errorResponse(
      new DocumentExtractionError(
        "extraction_failed",
        "We could not process this upload. Try again or paste the text manually.",
        500,
      ),
    );
  }
}
