import { KnowledgeError } from "./errors";
import { CHUNK_CHARS, MAX_CHUNKS, MAX_FILE_BYTES, MAX_PDF_PAGES, MAX_TEXT_CHARS, type KnowledgeFileType } from "./types";

export async function parseDocument(bytes: Uint8Array, type: KnowledgeFileType): Promise<string[]> {
  if (bytes.byteLength === 0) throw new KnowledgeError("EMPTY_FILE");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new KnowledgeError("FILE_TOO_LARGE");
  const text = type === "pdf" ? await parsePdf(bytes) : decodeText(bytes);
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) throw new KnowledgeError("EMPTY_FILE");
  if (normalized.length > MAX_TEXT_CHARS) throw new KnowledgeError("INVALID_FILE_CONTENT");
  return chunkText(normalized);
}

function decodeText(bytes: Uint8Array): string {
  try {
    const header = new TextDecoder().decode(bytes.subarray(0, 5));
    if (header === "%PDF-" || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) ||
        (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
        (bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes[0] === 0x1f && bytes[1] === 0x8b)) {
      throw new KnowledgeError("INVALID_FILE_CONTENT");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) {
      throw new KnowledgeError("INVALID_FILE_CONTENT");
    }
    return text.replace(/^\uFEFF/u, "");
  } catch {
    throw new KnowledgeError("INVALID_FILE_CONTENT");
  }
}

async function parsePdf(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new KnowledgeError("INVALID_FILE_CONTENT");
  }
  let task: { destroy(): Promise<void> } | undefined;
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    });
    task = loading;
    const pdf = await loading.promise;
    if (pdf.numPages < 1 || pdf.numPages > MAX_PDF_PAGES) throw new KnowledgeError("INVALID_FILE_CONTENT");
    const pages: string[] = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => "str" in item ? item.str : "").join(" ");
      length += pageText.length;
      if (length > MAX_TEXT_CHARS) throw new KnowledgeError("INVALID_FILE_CONTENT");
      pages.push(pageText);
      page.cleanup();
    }
    return pages.join("\n\n");
  } catch (error) {
    if (error instanceof KnowledgeError) throw error;
    throw new KnowledgeError("PDF_PARSE_FAILED");
  } finally {
    if (task) await task.destroy().catch(() => undefined);
  }
}

export function chunkText(text: string): string[] {
  const result: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + CHUNK_CHARS, text.length);
    if (end < text.length) {
      const window = text.slice(offset, end);
      const boundary = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
      if (boundary >= Math.floor(CHUNK_CHARS * 0.6)) end = offset + boundary + 1;
    }
    const chunk = text.slice(offset, end).trim();
    if (chunk) result.push(chunk);
    if (result.length > MAX_CHUNKS) throw new KnowledgeError("INVALID_FILE_CONTENT");
    offset = end;
  }
  return result;
}
