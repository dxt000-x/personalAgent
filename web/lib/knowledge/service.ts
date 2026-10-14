import { KnowledgeError } from "./errors";
import { parseDocument } from "./parse";
import { type KnowledgeDocument, type UploadInput } from "./types";

export interface KnowledgeRepository {
  list(userId: string, offset: number): Promise<KnowledgeDocument[]>;
  create(userId: string, input: UploadInput): Promise<KnowledgeDocument>;
  find(userId: string, documentId: string): Promise<KnowledgeDocument | null>;
  // Positive generation = claimed; 0 = busy; -1 = missing Storage; -2 = hourly processing limit.
  claim(userId: string, documentId: string): Promise<number>;
  read(path: string): Promise<Uint8Array>;
  complete(userId: string, documentId: string, generation: number, chunks: string[]): Promise<boolean>;
  fail(userId: string, documentId: string, generation: number, kind: "invalid_file" | "temporary"): Promise<boolean>;
  markDeleting(userId: string, documentId: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  finishDeleting(userId: string, documentId: string): Promise<boolean>;
}

export async function processKnowledgeDocument(
  repository: KnowledgeRepository, userId: string, documentId: string,
): Promise<KnowledgeDocument> {
  const document = await repository.find(userId, documentId);
  if (!document) throw new KnowledgeError("DOCUMENT_NOT_FOUND");
  if (document.status === "ready") return document;
  if (document.status === "deleting" ||
      (document.status === "failed" && document.failure_kind !== "temporary")) {
    throw new KnowledgeError("DOCUMENT_BUSY");
  }
  const generation = await repository.claim(userId, documentId);
  if (generation === -2) throw new KnowledgeError("PROCESS_RATE_LIMITED");
  if (generation === -1) throw new KnowledgeError("FILE_NOT_UPLOADED");
  if (generation < 1) throw new KnowledgeError("DOCUMENT_BUSY");

  try {
    const bytes = await repository.read(document.storage_path);
    if (bytes.byteLength !== document.byte_size) throw new KnowledgeError("INVALID_FILE_CONTENT");
    const chunks = await parseDocument(bytes, document.file_type);
    if (!await repository.complete(userId, documentId, generation, chunks)) {
      throw new KnowledgeError("DOCUMENT_BUSY");
    }
    const ready = await repository.find(userId, documentId);
    if (!ready) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    return ready;
  } catch (error) {
    const invalidFile = error instanceof KnowledgeError && [
      "EMPTY_FILE", "FILE_TOO_LARGE", "INVALID_FILE_CONTENT", "PDF_PARSE_FAILED", "PDF_NO_TEXT",
    ].includes(error.code);
    // A temporary failure keeps the original file and makes a same-document
    // retry available immediately. If this transition fails, the claim can
    // still be recovered after the stale-claim timeout.
    if (!invalidFile) {
      try { await repository.fail(userId, documentId, generation, "temporary"); } catch { /* stale claim fallback */ }
      throw error;
    }
    // A concurrent delete may have changed status to deleting. In that case the
    // delete path owns Storage cleanup; never turn it back into a failed row.
    let failed = false;
    try { failed = await repository.fail(userId, documentId, generation, "invalid_file"); } catch { /* stale claim fallback */ }
    if (failed) {
      try { await repository.remove(document.storage_path); }
      catch { throw new KnowledgeError("STORAGE_UNAVAILABLE"); }
    }
    throw error;
  }
}

export async function deleteKnowledgeDocument(
  repository: KnowledgeRepository, userId: string, documentId: string,
): Promise<void> {
  const document = await repository.find(userId, documentId);
  if (!document) throw new KnowledgeError("DOCUMENT_NOT_FOUND");
  if (!await repository.markDeleting(userId, documentId)) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  await repository.remove(document.storage_path);
  if (!await repository.finishDeleting(userId, documentId)) {
    throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  }
}
