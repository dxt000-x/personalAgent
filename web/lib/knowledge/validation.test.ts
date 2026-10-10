import { describe, expect, it } from "vitest";
import { KnowledgeError } from "./errors";
import { chunkText, parseDocument } from "./parse";
import { MAX_FILE_BYTES } from "./types";
import { validateUploadInput } from "./validation";

const bytes = (text: string) => new TextEncoder().encode(text);

function pdfWithText(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(source.length);
    source += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return bytes(source);
}

describe("knowledge upload validation", () => {
  it.each(["report.pdf", "notes.txt", "readme.md"])("accepts %s at the byte limit", (fileName) => {
    expect(validateUploadInput({ fileName, size: MAX_FILE_BYTES }).byteSize).toBe(MAX_FILE_BYTES);
  });
  it("rejects unsupported types, including the old demo DOCX", () => {
    expect(() => validateUploadInput({ fileName: "file.docx", size: 10 })).toThrowError(KnowledgeError);
    expect(() => validateUploadInput({ fileName: "file.docx", size: 10 })).toThrowError(/PDF/);
  });
  it("rejects oversized and empty files", () => {
    expect(() => validateUploadInput({ fileName: "a.pdf", size: MAX_FILE_BYTES + 1 })).toThrowError(/4 MiB/);
    expect(() => validateUploadInput({ fileName: "a.txt", size: 0 })).toThrowError(/没有可读取/);
  });
  it("rejects path separators, control characters, and unexpected fields", () => {
    for (const fileName of ["../secret.txt", "a\\b.md", "bad\nfile.pdf", "fake\u202Efdp.txt"]) {
      expect(() => validateUploadInput({ fileName, size: 10 })).toThrowError(KnowledgeError);
    }
    expect(() => validateUploadInput({ fileName: "a.txt", size: 10, user_id: "other" })).toThrowError(KnowledgeError);
  });
});

describe("content parsing and ordered chunks", () => {
  it("parses UTF-8 TXT and Markdown as text", async () => {
    expect(await parseDocument(bytes("你好\r\n世界"), "txt")).toEqual(["你好\n世界"]);
    expect(await parseDocument(bytes("# 标题\n正文"), "md")).toEqual(["# 标题\n正文"]);
  });
  it("extracts real PDF text using the PDF parser", async () => {
    const chunks = await parseDocument(pdfWithText("Hello PDF"), "pdf");
    expect(chunks.join(" ")).toContain("Hello PDF");
  });
  it("rejects wrong magic, malformed PDF, and scanned or empty text", async () => {
    await expect(parseDocument(bytes("not a PDF"), "pdf")).rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
    await expect(parseDocument(bytes("%PDF-1.4\ntruncated"), "pdf")).rejects.toMatchObject({ code: "PDF_PARSE_FAILED" });
    await expect(parseDocument(bytes("  \n  "), "txt")).rejects.toMatchObject({ code: "EMPTY_FILE" });
  });
  it("rejects non UTF-8 and obvious binary text", async () => {
    await expect(parseDocument(new Uint8Array([0xff, 0xfe]), "txt")).rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
    await expect(parseDocument(bytes("hello\u0000world"), "md")).rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
    await expect(parseDocument(pdfWithText("Hello"), "txt")).rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
  });
  it("splits in order without exceeding the database chunk length", () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => `section-${index} ${"word ".repeat(45)}`);
    const chunks = chunkText(paragraphs.join("\n"));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 1100)).toBe(true);
    const joined = chunks.join(" ");
    for (let index = 0; index < 12; index += 1) expect(joined).toContain(`section-${index}`);
    expect(joined.indexOf("section-0")).toBeLessThan(joined.indexOf("section-11"));
  });
});
