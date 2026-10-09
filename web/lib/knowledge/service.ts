import { KnowledgeError } from "./errors";
import { parseDocument } from "./parse";
import { type KnowledgeDocument, type UploadInput } from "./types";

export interface KnowledgeRepository {
  list(userId: string, offset: number): Promise<KnowledgeDocument[]>;
  create(userId: string, input: UploadInput): Promise<KnowledgeDocument>;
  find(userId: string, documentId: string): Promise<KnowledgeDocument | null>;
  claim(documentId: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
  complete(documentId: string, chunks: string[]): Promise<boolean>;
  fail(documentId: string): Promise<boolean>;
  markDeleting(documentId: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  finishDeleting(documentId: string): Promise<boolean>;
}

export async function processKnowledgeDocument(
  repository: KnowledgeRepository, userId: string, documentId: string,
): Promise<KnowledgeDocument> {
  const document = await repository.find(userId, documentId);
  if (!document) throw new KnowledgeError("DOCUMENT_NOT_FOUND");
  if (document.status === "ready") return document;
  if (document.status === "failed" || document.status === "deleting") {
    throw new KnowledgeError("DOCUMENT_BUSY");
  }
  if (!await repository.claim(documentId)) throw new KnowledgeError("DOCUMENT_BUSY");

  try {
    const bytes = await repository.read(document.storage_path);
    if (bytes.byteLength !== document.byte_size) throw new KnowledgeError("INVALID_FILE_CONTENT");
    const chunks = await parseDocument(bytes, document.file_type);
    if (!await repository.complete(documentId, chunks)) throw new KnowledgeError("DOCUMENT_BUSY");
    const ready = await repository.find(userId, documentId);
    if (!ready) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    return ready;
  } catch (error) {
    const invalidFile = error instanceof KnowledgeError && [
      "EMPTY_FILE", "FILE_TOO_LARGE", "INVALID_FILE_CONTENT", "PDF_PARSE_FAILED",
    ].includes(error.code);
    // Transient Storage/database errors keep the original object and the
    // processing claim. A stale claim can be retried after ten minutes.
    if (!invalidFile) throw error;
    // A concurrent delete may have changed status to deleting. In that case the
    // delete path owns Storage cleanup; never turn it back into a failed row.
    let failed = false;
    try { failed = await repository.fail(documentId); } catch { /* retryable processing row */ }
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
  if (!await repository.markDeleting(documentId)) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  await repository.remove(document.storage_path);
  if (!await repository.finishDeleting(documentId)) {
    throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  }
}
