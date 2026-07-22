import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/documents/extract/route";

function requestWithFile(
  contents: BlobPart,
  filename: string,
  type: string,
): Request {
  const form = new FormData();
  form.append("file", new Blob([contents], { type }), filename);
  return new Request("http://localhost/api/documents/extract", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/documents/extract", () => {
  it("extracts a TXT upload without persisting it", async () => {
    const response = await POST(
      requestWithFile("Title: Data Analyst\nRequired: SQL", "job.txt", "text/plain") as never,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      text: "Title: Data Analyst\nRequired: SQL",
      filename: "job.txt",
      kind: "txt",
    });
  });

  it("rejects a request without a file", async () => {
    const response = await POST(
      new Request("http://localhost/api/documents/extract", {
        method: "POST",
        body: new FormData(),
      }) as never,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_file" });
  });

  it("rejects unsupported extensions and mismatched PDF contents", async () => {
    const unsupported = await POST(
      requestWithFile("legacy", "resume.doc", "application/msword") as never,
    );
    expect(unsupported.status).toBe(415);

    const fakePdf = await POST(
      requestWithFile("plain text", "resume.pdf", "application/pdf") as never,
    );
    expect(fakePdf.status).toBe(400);
    await expect(fakePdf.json()).resolves.toMatchObject({ code: "invalid_file" });
  });

  it("returns a useful error for an empty text document", async () => {
    const response = await POST(requestWithFile("   ", "resume.txt", "text/plain") as never);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "no_extractable_text" });
  });
});
