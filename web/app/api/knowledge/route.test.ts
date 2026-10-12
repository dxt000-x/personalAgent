import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";
import { POST as PROCESS } from "./[id]/process/route";
import { KnowledgeError } from "@/lib/knowledge/errors";
import { requireKnowledgeContext } from "@/lib/knowledge/server";
import type { KnowledgeDocument } from "@/lib/knowledge/types";

vi.mock("@/lib/knowledge/server", async (original) => ({
  ...await original<typeof import("@/lib/knowledge/server")>(),
  requireKnowledgeContext: vi.fn(),
}));

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const documentId = "11111111-1111-4111-8111-111111111111";
const content = new TextEncoder().encode("实际上传的正文。");
const document: KnowledgeDocument = {
  id: documentId, user_id: userA, file_name: "notes.txt", file_type: "txt",
  byte_size: content.length, storage_path: `${userA}/${documentId}/source.txt`,
  status: "uploading", failure_kind: null, processing_generation: 0, chunk_count: 0,
  created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z",
};

function fakeRepository() {
  const row = { ...document };
  const repository = {
    list: vi.fn(async (userId: string) => userId === userA ? [row] : []),
    create: vi.fn(async (userId: string, input: { fileName: string; byteSize: number }) =>
      ({ ...row, user_id: userId, file_name: input.fileName, byte_size: input.byteSize,
        storage_path: `${userId}/${documentId}/source.txt` })),
    find: vi.fn(async (userId: string, id: string) => userId === userA && id === documentId ? row : null),
    claim: vi.fn(async () => { row.status = "processing" as const; row.processing_generation += 1; return row.processing_generation; }),
    read: vi.fn(async () => content),
    complete: vi.fn(async (_userId: string, _id: string, _generation: number, chunks: string[]) => {
      row.status = "ready";
      row.chunk_count = chunks.length;
      return true;
    }),
    fail: vi.fn(async () => true),
    markDeleting: vi.fn(async () => { row.status = "deleting"; return true; }),
    remove: vi.fn(async () => undefined),
    finishDeleting: vi.fn(async () => true),
  };
  return repository;
}

function request(path: string, method: string, body?: unknown, origin?: string) {
  return new Request(`http://localhost:3000${path}`, { method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(origin ? { Origin: origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => { vi.resetAllMocks(); });

describe("knowledge API security and upload lifecycle", () => {
  it("logs only fixed failure metadata and keeps the response safe", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const repository = fakeRepository();
      repository.create.mockRejectedValueOnce(new Error("password=secret-never-log"));
      vi.mocked(requireKnowledgeContext).mockResolvedValue({ userId: userA, repository });
      const response = await POST(request("/api/knowledge", "POST", { fileName: "notes.txt", size: 10 }));
      expect(response.status).toBe(503);
      expect(log).toHaveBeenCalledWith("KNOWLEDGE_API_FAIL", {
        stage: "KNOWLEDGE_API_FAIL", error_class: "UNEXPECTED_ERROR",
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret-never-log");
      expect(JSON.stringify(await response.json())).not.toContain("secret-never-log");
    } finally { log.mockRestore(); }
  });
  it("requires authentication for list, upload, processing, and delete", async () => {
    vi.mocked(requireKnowledgeContext).mockRejectedValue(new KnowledgeError("AUTH_REQUIRED"));
    const context = { params: Promise.resolve({ id: documentId }) };
    for (const response of [
      await GET(request("/api/knowledge", "GET")),
      await POST(request("/api/knowledge", "POST", { fileName: "a.txt", size: 1 })),
      await PROCESS(request(`/api/knowledge/${documentId}/process`, "POST"), context),
      await DELETE(request(`/api/knowledge/${documentId}`, "DELETE"), context),
    ]) {
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("AUTH_REQUIRED");
    }
  });

  it("creates a pending record using authenticated identity and only small JSON", async () => {
    const repository = fakeRepository();
    vi.mocked(requireKnowledgeContext).mockResolvedValue({ userId: userA, repository });
    const response = await POST(request("/api/knowledge", "POST", { fileName: "notes.txt", size: content.length }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.upload.path).toBe(document.storage_path);
    expect(body.upload.contentType).toBe("text/plain");
    expect(repository.create).toHaveBeenCalledWith(userA, expect.objectContaining({ byteSize: content.length }));
  });

  it("rejects client-supplied ownership on upload initialization", async () => {
    const repository = fakeRepository();
    vi.mocked(requireKnowledgeContext).mockResolvedValue({ userId: userA, repository });
    const response = await POST(request("/api/knowledge", "POST", {
      fileName: "notes.txt", size: content.length, user_id: userB,
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects invalid type, oversized body, and cross-origin mutation before creating data", async () => {
    const repository = fakeRepository();
    vi.mocked(requireKnowledgeContext).mockResolvedValue({ userId: userA, repository });
    const badType = await POST(request("/api/knowledge", "POST", { fileName: "bad.docx", size: 20 }));
    expect((await badType.json()).error.code).toBe("UNSUPPORTED_FILE");
    const oversized = await POST(request("/api/knowledge", "POST", { fileName: "a.txt", size: 4194305 }));
    expect((await oversized.json()).error.code).toBe("FILE_TOO_LARGE");
    const crossOrigin = await POST(request("/api/knowledge", "POST", { fileName: "a.txt", size: 1 }, "https://attacker.invalid"));
    expect((await crossOrigin.json()).error.code).toBe("INVALID_REQUEST");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("lists only the authenticated user's rows", async () => {
    const repository = fakeRepository();
    vi.mocked(requireKnowledgeContext).mockResolvedValue({ userId: userB, repository });
    expect((await (await GET(request("/api/knowledge", "GET"))).json()).documents).toEqual([]);
    expect(repository.list).toHaveBeenCalledWith(userB, 0);
  });

  it("accepts a bounded list offset and rejects malformed pagination", async () => {
    const repository = fakeRepository();
    vi.mocked(requireKnowledgeContext).mockResolvedValue({ userId: userA, repository });
    expect((await GET(request("/api/knowledge?offset=100", "GET"))).status).toBe(200);
    expect(repository.list).toHaveBeenCalledWith(userA, 100);
    const bad = await GET(request("/api/knowledge?offset=-1", "GET"));
    expect(bad.status).toBe(400);
  });

  it("processes stored file through service and returns ready metadata", async () => {
    const repository = fakeRepository();
    vi.mocked(requireKnowledgeContext).mockResolvedValue({ userId: userA, repository });
    const response = await PROCESS(request(`/api/knowledge/${documentId}/process`, "POST", { user_id: userB }),
      { params: Promise.resolve({ id: documentId }) });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect((await response.json()).document.status).toBe("ready");
    expect(repository.read).toHaveBeenCalledWith(document.storage_path);
    expect(repository.claim).toHaveBeenCalledWith(userA, documentId);
    expect(repository.complete).toHaveBeenCalledWith(userA, documentId, 1, ["实际上传的正文。"]);
  });

  it("rejects another user's processing and delete requests", async () => {
    const repository = fakeRepository();
    vi.mocked(requireKnowledgeContext).mockResolvedValue({ userId: userB, repository });
    const context = { params: Promise.resolve({ id: documentId }) };
    const process = await PROCESS(request(`/api/knowledge/${documentId}/process`, "POST"), context);
    const remove = await DELETE(request(`/api/knowledge/${documentId}`, "DELETE"), context);
    expect(process.status, JSON.stringify(await process.clone().json())).toBe(404);
    expect(remove.status).toBe(404);
    expect(repository.read).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it("deletes through Storage first and responds without leaking file content", async () => {
    const repository = fakeRepository();
    vi.mocked(requireKnowledgeContext).mockResolvedValue({ userId: userA, repository });
    const response = await DELETE(request(`/api/knowledge/${documentId}`, "DELETE", { user_id: userB }),
      { params: Promise.resolve({ id: documentId }) });
    expect(response.status).toBe(204);
    expect(repository.remove).toHaveBeenCalledWith(document.storage_path);
    expect(repository.markDeleting).toHaveBeenCalledWith(userA, documentId);
    expect(repository.remove.mock.invocationCallOrder[0]).toBeLessThan(
      repository.finishDeleting.mock.invocationCallOrder[0],
    );
  });
});
