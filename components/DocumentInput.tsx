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
  const textareaId = useId();
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

  const uploadControl = (
    <>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT}
        disabled={state === "uploading"}
        onChange={(event) => receiveFiles(event.target.files)}
        className="document-input__file"
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
        className="document-input__dropzone"
      >
        <span className="document-input__icon" aria-hidden="true">
          {state === "uploading" ? <span className="document-input__spinner" /> : filename ? "✓" : "↥"}
        </span>
        <div className="document-input__drop-copy">
          <div className="document-input__title">
            {state === "uploading"
              ? `Reading ${filename ?? "document"}…`
              : filename
                ? filename
                : <>Drop your {kind} here or <span className="document-input__action">choose a file</span></>}
          </div>
          <div className="document-input__guidance">PDF, DOCX, or TXT <span aria-hidden="true">·</span> up to 10 MB</div>
        </div>
      </label>

      {(message || filename) && (
        <div
          role={state === "error" ? "alert" : "status"}
          aria-live="polite"
          className="document-input__status"
        >
          <span className="document-input__status-message">
            <span className="document-input__status-dot" aria-hidden="true" />
            {message}
          </span>
          {filename && state !== "uploading" && (
            <button
              type="button"
              onClick={removeFile}
              className="document-input__remove"
            >
              Remove file
            </button>
          )}
        </div>
      )}
    </>
  );

  const divider = (
    <div className="document-input__divider" aria-hidden="true">
      <span />
      <small>{kind === "resume" ? "or paste manually" : "or upload a document"}</small>
      <span />
    </div>
  );

  const textControl = (
    <>
      <label htmlFor={textareaId} className="document-input__text-label">
        {textareaLabel}
        <span>{value.length.toLocaleString()} characters</span>
      </label>
      <textarea
        id={textareaId}
        value={value}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={placeholder}
        aria-label={textareaLabel}
        className="form-control document-input__textarea"
        style={{
          height,
        }}
      />
    </>
  );

  return (
    <div
      className={`document-input document-input--${kind === "resume" ? "resume" : "job-description"}`}
      data-state={state}
      data-dragging={dragging ? "true" : "false"}
    >
      {kind === "job description" ? (
        <>
          {textControl}
          {divider}
          {uploadControl}
        </>
      ) : (
        <>
          {uploadControl}
          {divider}
          {textControl}
        </>
      )}
    </div>
  );
}
