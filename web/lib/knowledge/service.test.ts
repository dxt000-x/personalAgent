import { describe, expect, it } from "vitest";
import { deleteKnowledgeDocument, processKnowledgeDocument, type KnowledgeRepository } from "./service";
import { KnowledgeError } from "./errors";
import type { KnowledgeDocument, UploadInput } from "./types";

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = "11111111-1111-4111-8111-111111111111";
const text = new TextEncoder().encode("个人知识库测试正文。".repeat(160));

class FakeRepository implements KnowledgeRepository {
  documents = new Map<string, KnowledgeDocument>();
  objects = new Map<string, Uint8Array>();
  chunks = new Map<string, string[]>();
  failRead = false;
  failRemove = false;
  failComplete = false;
  removed = 0;

  constructor() {
    const doc: KnowledgeDocument = {
      id, user_id: userA, file_name: "notes.txt", file_type: "txt", byte_size: text.length,
      storage_path: `${userA}/${id}/source.txt`, status: "uploading", chunk_count: 0,
      created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z",
    };
    this.documents.set(id, doc);
    this.objects.set(doc.storage_path, text);
  }
  async list(userId: string) { return [...this.documents.values()].filter((item) => item.user_id === userId); }
  async create(userId: string, input: UploadInput) {
    const doc = this.documents.get(id)!;
    const newDoc = { ...doc, user_id: userId, file_name: input.fileName, file_type: input.fileType,
      byte_size: input.byteSize, storage_path: `${userId}/${id}/source.${input.fileType}` };
    this.documents.set(id, newDoc);
    return newDoc;
  }
  async find(userId: string, documentId: string) {
    const doc = this.documents.get(documentId);
    return doc?.user_id === userId ? doc : null;
  }
  async claim(documentId: string) {
    const doc = this.documents.get(documentId);
    if (!doc || doc.status !== "uploading") return false;
    doc.status = "processing";
    return true;
  }
  async read(path: string) {
    if (this.failRead || !this.objects.has(path)) throw new KnowledgeError("STORAGE_UNAVAILABLE");
    return this.objects.get(path)!;
  }
  async complete(documentId: string, chunks: string[]) {
    const doc = this.documents.get(documentId);
    if (this.failComplete || !doc || doc.status !== "processing") return false;
    this.chunks.set(documentId, chunks);
    doc.status = "ready";
    doc.chunk_count = chunks.length;
    return true;
  }
  async fail(documentId: string) {
    const doc = this.documents.get(documentId);
    if (!doc || doc.status !== "processing") return false;
    doc.status = "failed";
    return true;
  }
  async markDeleting(documentId: string) {
    const doc = this.documents.get(documentId);
    if (!doc) return false;
    doc.status = "deleting";
    return true;
  }
  async remove(path: string) {
    if (this.failRemove) throw new KnowledgeError("STORAGE_UNAVAILABLE");
    this.objects.delete(path);
    this.removed += 1;
  }
  async finishDeleting(documentId: string) {
    const doc = this.documents.get(documentId);
    if (!doc || doc.status !== "deleting" || this.objects.has(doc.storage_path)) return false;
    this.documents.delete(documentId);
    this.chunks.delete(documentId);
    return true;
  }
}

describe("knowledge ingestion and cleanup", () => {
  it("processes a normal upload into ordered chunks and is idempotent once ready", async () => {
    const repo = new FakeRepository();
    const ready = await processKnowledgeDocument(repo, userA, id);
    expect(ready.status).toBe("ready");
    expect(ready.chunk_count).toBeGreaterThan(1);
    expect(repo.chunks.get(id)?.join(" ")).toContain("个人知识库测试正文");
    expect(await processKnowledgeDocument(repo, userA, id)).toBe(ready);
  });
  it("never reads or deletes another user's document", async () => {
    const repo = new FakeRepository();
    await expect(processKnowledgeDocument(repo, userB, id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(deleteKnowledgeDocument(repo, userB, id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect(repo.documents.has(id)).toBe(true);
    expect(repo.removed).toBe(0);
  });
  it("retains the original file after a transient Storage download failure", async () => {
    const repo = new FakeRepository();
    repo.failRead = true;
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(repo.documents.get(id)?.status).toBe("processing");
    expect(repo.objects.size).toBe(1);
  });
  it("rejects a content mismatch and removes the intermediate file", async () => {
    const repo = new FakeRepository();
    repo.objects.set(repo.documents.get(id)!.storage_path, new TextEncoder().encode("other bytes"));
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
    expect(repo.documents.get(id)?.status).toBe("failed");
    expect(repo.objects.size).toBe(0);
  });
  it("marks a malformed PDF failed and cleans the original object", async () => {
    const repo = new FakeRepository();
    const doc = repo.documents.get(id)!;
    doc.file_type = "pdf";
    const badPdf = new TextEncoder().encode("%PDF-1.4\ntruncated");
    doc.byte_size = badPdf.length;
    repo.objects.set(doc.storage_path, badPdf);
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "PDF_PARSE_FAILED" });
    expect(doc.status).toBe("failed");
    expect(repo.objects.has(doc.storage_path)).toBe(false);
  });
  it("preserves failed metadata for retryable deletion if cleanup Storage fails", async () => {
    const repo = new FakeRepository();
    repo.objects.set(repo.documents.get(id)!.storage_path, new TextEncoder().encode("wrong size"));
    repo.failRemove = true;
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(repo.documents.get(id)?.status).toBe("failed");
    expect(repo.objects.size).toBe(1);
    repo.failRemove = false;
    await deleteKnowledgeDocument(repo, userA, id);
    expect(repo.documents.has(id)).toBe(false);
  });
  it("deletes original file, document, and chunks together", async () => {
    const repo = new FakeRepository();
    await processKnowledgeDocument(repo, userA, id);
    await deleteKnowledgeDocument(repo, userA, id);
    expect(repo.objects.size).toBe(0);
    expect(repo.documents.size).toBe(0);
    expect(repo.chunks.size).toBe(0);
  });
  it("keeps a deleting row after Storage failure and can retry", async () => {
    const repo = new FakeRepository();
    repo.failRemove = true;
    await expect(deleteKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(repo.documents.get(id)?.status).toBe("deleting");
    repo.failRemove = false;
    await deleteKnowledgeDocument(repo, userA, id);
    expect(repo.documents.has(id)).toBe(false);
  });
  it("does not publish chunks after a concurrent delete changes status", async () => {
    const repo = new FakeRepository();
    repo.failComplete = true;
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "DOCUMENT_BUSY" });
    expect(repo.chunks.size).toBe(0);
    expect(repo.documents.get(id)?.status).toBe("processing");
  });
});
