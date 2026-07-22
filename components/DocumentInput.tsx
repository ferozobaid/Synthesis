"use client";

import { DragEvent, useId, useRef, useState } from "react";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt"];
const ACCEPT = [
  ...ACCEPTED_EXTENSIONS,
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
].join(",");

type UploadState = "idle" | "uploading" | "success" | "error";

interface DocumentInputProps {
  kind: "resume" | "job description";
  value: string;
  onTextChange: (text: string) => void;
  textareaLabel: string;
  placeholder: string;
  height?: number;
}

interface ExtractResponse {
  text?: string;
  filename?: string;
  error?: string;
}

export function validateClientDocument(file: Pick<File, "name" | "size">): string | null {
  const lower = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return "Upload a PDF, DOCX, or TXT file.";
  }
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > MAX_BYTES) return "The selected file is larger than 10 MB.";
  return null;
}

export function DocumentInput({
  kind,
  value,
  onTextChange,
  textareaLabel,
  placeholder,
  height = 120,
}: DocumentInputProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [filename, setFilename] = useState<string | null>(null);
  const [lastExtractedText, setLastExtractedText] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    const validationError = validateClientDocument(file);
    if (validationError) {
      setState("error");
      setMessage(validationError);
      return;
    }

    const wouldReplaceEditedText =
      value.trim().length > 0 && (lastExtractedText === null || value !== lastExtractedText);
    if (
      wouldReplaceEditedText &&
      !window.confirm(`Replace the current ${kind} text with text from ${file.name}?`)
    ) {
      return;
    }

    setState("uploading");
    setFilename(file.name);
    setMessage(null);
    const form = new FormData();
    form.append("file", file);

    try {
      const response = await fetch("/api/documents/extract", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as ExtractResponse;
      if (!response.ok || !data.text) {
        throw new Error(data.error || "We could not read this document.");
      }
      onTextChange(data.text);
      setLastExtractedText(data.text);
      setFilename(data.filename || file.name);
      setState("success");
      setMessage("Text extracted. Review it below before continuing.");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "We could not read this document. Paste the text manually instead.",
      );
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function receiveFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void upload(file);
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (state !== "uploading") receiveFiles(event.dataTransfer.files);
  }

  function removeFile() {
    setFilename(null);
    setLastExtractedText(null);
    setState("idle");
    setMessage("The extracted text remains available below.");
  }

  return (
    <div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT}
        disabled={state === "uploading"}
        onChange={(event) => receiveFiles(event.target.files)}
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
      />
      <label
        htmlFor={inputId}
        onDragEnter={(event) => {
          event.preventDefault();
          if (state !== "uploading") setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={drop}
        style={{
          display: "block",
          border: `1.5px dashed ${dragging ? "var(--accent)" : "var(--line)"}`,
          borderRadius: 12,
          padding: "17px 18px",
          textAlign: "center",
          background: dragging ? "var(--accent-tint)" : "var(--surface-2)",
          cursor: state === "uploading" ? "wait" : "pointer",
          transition: "border-color .15s ease, background .15s ease",
        }}
      >
        <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 600, marginBottom: 4 }}>
          {state === "uploading"
            ? `Reading ${filename ?? "document"}…`
            : filename
              ? filename
              : `Drop your ${kind} here or choose a file`}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-4)" }}>PDF, DOCX, or TXT · up to 10 MB</div>
      </label>

      {(message || filename) && (
        <div
          role={state === "error" ? "alert" : "status"}
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginTop: 8,
            minHeight: 20,
            fontSize: 11.5,
            color: state === "error" ? "var(--gap)" : "var(--ink-3)",
          }}
        >
          <span>{message}</span>
          {filename && state !== "uploading" && (
            <button
              type="button"
              onClick={removeFile}
              style={{
                border: 0,
                padding: 0,
                background: "transparent",
                color: "var(--accent-ink)",
                cursor: "pointer",
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              Remove file
            </button>
          )}
        </div>
      )}

      <textarea
        value={value}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={placeholder}
        aria-label={textareaLabel}
        style={{
          marginTop: 10,
          width: "100%",
          height,
          resize: "vertical",
          border: "1px solid var(--line)",
          borderRadius: 10,
          padding: "11px 12px",
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--ink)",
          background: "var(--surface)",
          outline: "none",
        }}
      />
    </div>
  );
}
