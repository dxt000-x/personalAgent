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
  staleProcessing = false;
  rateLimited = false;
  removed = 0;

  constructor() {
    const doc: KnowledgeDocument = {
      id, user_id: userA, file_name: "notes.txt", file_type: "txt", byte_size: text.length,
      storage_path: `${userA}/${id}/source.txt`, status: "uploading", failure_kind: null,
      processing_generation: 0, chunk_count: 0,
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
  async claim(userId: string, documentId: string) {
    const doc = this.documents.get(documentId);
    if (!doc || doc.user_id !== userId ||
        (doc.status !== "uploading" && !(doc.status === "failed" && doc.failure_kind === "temporary") &&
        !(doc.status === "processing" && this.staleProcessing))) return 0;
    if (!this.objects.has(doc.storage_path)) return -1;
    if (this.rateLimited) return -2;
    doc.status = "processing";
    doc.failure_kind = null;
    doc.processing_generation += 1;
    return doc.processing_generation;
  }
  async read(path: string) {
    if (this.failRead || !this.objects.has(path)) throw new KnowledgeError("STORAGE_UNAVAILABLE");
    return this.objects.get(path)!;
  }
  async complete(userId: string, documentId: string, generation: number, chunks: string[]) {
    const doc = this.documents.get(documentId);
    if (this.failComplete || !doc || doc.user_id !== userId || doc.status !== "processing" ||
        doc.processing_generation !== generation) return false;
    this.chunks.set(documentId, chunks);
    doc.status = "ready";
    doc.chunk_count = chunks.length;
    return true;
  }
  async fail(userId: string, documentId: string, generation: number, kind: "invalid_file" | "temporary") {
    const doc = this.documents.get(documentId);
    if (!doc || doc.user_id !== userId || doc.status !== "processing" || doc.processing_generation !== generation) return false;
    doc.status = "failed";
    doc.failure_kind = kind;
    return true;
  }
  async markDeleting(userId: string, documentId: string) {
    const doc = this.documents.get(documentId);
    if (!doc || doc.user_id !== userId) return false;
    doc.status = "deleting";
    doc.processing_generation += 1;
    return true;
  }
  async remove(path: string) {
    if (this.failRemove) throw new KnowledgeError("STORAGE_UNAVAILABLE");
    this.objects.delete(path);
    this.removed += 1;
  }
  async finishDeleting(userId: string, documentId: string) {
    const doc = this.documents.get(documentId);
    if (!doc || doc.user_id !== userId || doc.status !== "deleting" || this.objects.has(doc.storage_path)) return false;
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
  it("retains the original file and permits retry after a transient Storage failure", async () => {
    const repo = new FakeRepository();
    repo.failRead = true;
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(repo.documents.get(id)?.status).toBe("failed");
    expect(repo.documents.get(id)?.failure_kind).toBe("temporary");
    expect(repo.objects.size).toBe(1);
    repo.failRead = false;
    expect((await processKnowledgeDocument(repo, userA, id)).status).toBe("ready");
  });
  it("rejects a content mismatch and removes the intermediate file", async () => {
    const repo = new FakeRepository();
    repo.objects.set(repo.documents.get(id)!.storage_path, new TextEncoder().encode("other bytes"));
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
    expect(repo.documents.get(id)?.status).toBe("failed");
    expect(repo.objects.size).toBe(0);
  });
  it("classifies an all-whitespace original as an invalid file and removes it", async () => {
    const repo = new FakeRepository();
    const doc = repo.documents.get(id)!;
    const whitespace = new TextEncoder().encode("  \n \t ");
    doc.byte_size = whitespace.length;
    repo.objects.set(doc.storage_path, whitespace);
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "EMPTY_FILE" });
    expect(doc.status).toBe("failed");
    expect(doc.failure_kind).toBe("invalid_file");
    expect(repo.objects.has(doc.storage_path)).toBe(false);
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "DOCUMENT_BUSY" });
  });
  it("classifies an oversized original as an invalid file and removes it", async () => {
    const repo = new FakeRepository();
    const doc = repo.documents.get(id)!;
    const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
    doc.byte_size = oversized.length;
    repo.objects.set(doc.storage_path, oversized);
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(doc.status).toBe("failed");
    expect(doc.failure_kind).toBe("invalid_file");
    expect(repo.objects.has(doc.storage_path)).toBe(false);
  });
  it("classifies invalid UTF-8 as an invalid file and removes it", async () => {
    const repo = new FakeRepository();
    const doc = repo.documents.get(id)!;
    const invalid = new Uint8Array([0xc3, 0x28]);
    doc.byte_size = invalid.length;
    repo.objects.set(doc.storage_path, invalid);
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
    expect(doc.status).toBe("failed");
    expect(doc.failure_kind).toBe("invalid_file");
    expect(repo.objects.has(doc.storage_path)).toBe(false);
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
    expect(doc.failure_kind).toBe("invalid_file");
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
    expect(repo.documents.get(id)?.status).toBe("failed");
    expect(repo.documents.get(id)?.failure_kind).toBe("temporary");
  });
  it("does not claim processing when the original Storage object is missing", async () => {
    const repo = new FakeRepository();
    repo.objects.clear();
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "FILE_NOT_UPLOADED" });
    expect(repo.documents.get(id)?.status).toBe("uploading");
    expect(repo.documents.get(id)?.processing_generation).toBe(0);
  });
  it("does not process when the hourly processing limit is reached", async () => {
    const repo = new FakeRepository();
    repo.rateLimited = true;
    await expect(processKnowledgeDocument(repo, userA, id)).rejects.toMatchObject({ code: "PROCESS_RATE_LIMITED" });
    expect(repo.documents.get(id)?.status).toBe("uploading");
    expect(repo.chunks.size).toBe(0);
  });
  it("checks ownership again inside every fake transition", async () => {
    const repo = new FakeRepository();
    expect(await repo.claim(userB, id)).toBe(0);
    expect(await repo.markDeleting(userB, id)).toBe(false);
    const generation = await repo.claim(userA, id);
    expect(await repo.complete(userB, id, generation, ["injected"])).toBe(false);
    expect(await repo.fail(userB, id, generation, "temporary")).toBe(false);
    expect(repo.documents.get(id)?.status).toBe("processing");
  });
  it("allows only one simultaneous processing claim", async () => {
    const repo = new FakeRepository();
    const first = await repo.claim(userA, id);
    const second = await repo.claim(userA, id);
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(await repo.complete(userA, id, first, ["verified chunk"])).toBe(true);
  });
  it("rejects an old result after a stale claim is taken over", async () => {
    const repo = new FakeRepository();
    const oldGeneration = await repo.claim(userA, id);
    repo.staleProcessing = true;
    const newGeneration = await repo.claim(userA, id);
    expect(newGeneration).toBe(oldGeneration + 1);
    expect(await repo.complete(userA, id, oldGeneration, ["stale"])).toBe(false);
    expect(await repo.fail(userA, id, oldGeneration, "invalid_file")).toBe(false);
    expect(await repo.complete(userA, id, newGeneration, ["fresh"])).toBe(true);
    expect(repo.chunks.get(id)).toEqual(["fresh"]);
  });
  it("deletion invalidates an active processor before it can publish", async () => {
    const repo = new FakeRepository();
    const generation = await repo.claim(userA, id);
    expect(await repo.markDeleting(userA, id)).toBe(true);
    expect(await repo.complete(userA, id, generation, ["late"])).toBe(false);
    expect(await repo.fail(userA, id, generation, "temporary")).toBe(false);
    await repo.remove(repo.documents.get(id)!.storage_path);
    expect(await repo.finishDeleting(userA, id)).toBe(true);
    expect(repo.chunks.size).toBe(0);
  });
});
