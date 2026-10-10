import { KnowledgeError } from "./errors";
import { MAX_FILE_BYTES, type KnowledgeFileType, type UploadInput } from "./types";

const mime: Record<KnowledgeFileType, string> = {
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateDocumentId(value: string): string {
  if (!uuidPattern.test(value)) throw new KnowledgeError("INVALID_REQUEST");
  return value;
}

export function validateUploadInput(value: unknown): UploadInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KnowledgeError("INVALID_REQUEST");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "fileName,size") {
    throw new KnowledgeError("INVALID_REQUEST");
  }
  if (typeof input.fileName !== "string" || input.fileName.length < 1 || input.fileName.length > 180 ||
      /[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/u.test(input.fileName) || input.fileName !== input.fileName.trim() ||
      input.fileName === "." || input.fileName === "..") {
    throw new KnowledgeError("INVALID_REQUEST");
  }
  const extension = /\.([^.]+)$/u.exec(input.fileName)?.[1].toLowerCase();
  if (extension !== "pdf" && extension !== "txt" && extension !== "md") {
    throw new KnowledgeError("UNSUPPORTED_FILE");
  }
  if (!Number.isSafeInteger(input.size) || (input.size as number) < 0) {
    throw new KnowledgeError("INVALID_REQUEST");
  }
  if (input.size === 0) throw new KnowledgeError("EMPTY_FILE");
  if ((input.size as number) > MAX_FILE_BYTES) throw new KnowledgeError("FILE_TOO_LARGE");
  return {
    fileName: input.fileName,
    fileType: extension,
    byteSize: input.size as number,
    contentType: mime[extension],
  };
}

export async function readSmallJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new KnowledgeError("INVALID_REQUEST");
  }
  if (!request.body || Number(request.headers.get("content-length")) > 4096) {
    throw new KnowledgeError("INVALID_REQUEST");
  }
  const reader = request.body.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new KnowledgeError("INVALID_REQUEST");
      }
      parts.push(value);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
  } catch (error) {
    if (error instanceof KnowledgeError) throw error;
    throw new KnowledgeError("INVALID_REQUEST");
  } finally {
    reader.releaseLock();
  }
}
