import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { KnowledgeError } from "@/lib/knowledge/errors";
import { searchKnowledgeChunks } from "@/lib/knowledge/search";
import { requireKnowledgeSearchContext } from "@/lib/knowledge/server";

vi.mock("@/lib/knowledge/search", async (original) => ({
  ...await original<typeof import("@/lib/knowledge/search")>(), searchKnowledgeChunks: vi.fn(),
}));
vi.mock("@/lib/knowledge/server", async (original) => ({
  ...await original<typeof import("@/lib/knowledge/server")>(), requireKnowledgeSearchContext: vi.fn(),
}));

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentA = "11111111-1111-4111-8111-111111111111";
const fakeClient = { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } };

function request(body: unknown, options: { contentType?: string; origin?: string } = {}) {
  return new Request("http://localhost:3000/api/knowledge/search", { method: "POST",
    headers: { "Content-Type": options.contentType ?? "application/json", ...(options.origin ? { Origin: options.origin } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireKnowledgeSearchContext).mockResolvedValue({ userId: userA, client: fakeClient as never });
  vi.mocked(searchKnowledgeChunks).mockResolvedValue([]);
});

describe("POST /api/knowledge/search", () => {
  it("requires authentication before searching", async () => {
    vi.mocked(requireKnowledgeSearchContext).mockRejectedValue(new KnowledgeError("AUTH_REQUIRED"));
    const response = await POST(request({ query: "笔记" }));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("AUTH_REQUIRED");
    expect(searchKnowledgeChunks).not.toHaveBeenCalled();
  });

  it.each([{ query: "" }, { query: "a".repeat(101) }, { query: "%" }, { query: "_" },
    { query: "a", user_id: "other" }, { query: 123 },
    { query: "a", documentId: "" }, { query: "a", documentId: "invalid" },
    { query: "a", documentId: 42 }, { query: "a", documentId: [] }])("rejects invalid search input", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(searchKnowledgeChunks).not.toHaveBeenCalled();
  });

  it("rejects invalid MIME, oversized body and cross-origin requests", async () => {
    for (const input of [request({ query: "test" }, { contentType: "text/plain" }),
      request({ query: "x".repeat(600) }), request({ query: "test" }, { origin: "https://other.invalid" })]) {
      expect((await POST(input)).status).toBe(400);
    }
    expect(searchKnowledgeChunks).not.toHaveBeenCalled();
  });

  it("uses only the verified user ID and returns bounded public fields without writes", async () => {
    vi.mocked(searchKnowledgeChunks).mockResolvedValue([{ documentId: "doc", fileName: "notes.txt", chunkIndex: 1, snippet: "机器学习" }]);
    const response = await POST(request({ query: "机器学习" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ results: [{ documentId: "doc", fileName: "notes.txt", chunkIndex: 1, snippet: "机器学习" }] });
    expect(searchKnowledgeChunks).toHaveBeenCalledWith(fakeClient, userA, "机器学习", undefined);
    expect(fakeClient.from).not.toHaveBeenCalled();
    expect(fakeClient.rpc).not.toHaveBeenCalled();
    expect(fakeClient.storage.from).not.toHaveBeenCalled();
  });

  it("passes a validated documentId to the search layer without changing response fields", async () => {
    vi.mocked(searchKnowledgeChunks).mockResolvedValue([{ documentId: documentA,
      fileName: "A.txt", chunkIndex: 0, snippet: "test" }]);
    const response = await POST(request({ query: "test", documentId: documentA }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [{ documentId: documentA,
      fileName: "A.txt", chunkIndex: 0, snippet: "test" }] });
    expect(searchKnowledgeChunks).toHaveBeenCalledWith(fakeClient, userA, "test", documentA);
  });

  it("passes a canonical documentId for a valid uppercase UUID", async () => {
    const uppercase = "A1B2C3D4-E5F6-4A7B-8C9D-A1B2C3D4E5F6";
    const canonical = uppercase.toLowerCase();
    vi.mocked(searchKnowledgeChunks).mockResolvedValue([{ documentId: canonical,
      fileName: "A.txt", chunkIndex: 0, snippet: "test" }]);
    const response = await POST(request({ query: "test", documentId: uppercase }));
    expect(response.status).toBe(200);
    expect(searchKnowledgeChunks).toHaveBeenCalledWith(fakeClient, userA, "test", canonical);
    expect(await response.json()).toEqual({ results: [{ documentId: canonical,
      fileName: "A.txt", chunkIndex: 0, snippet: "test" }] });
  });

  it("returns a fixed safe error when the database is unavailable", async () => {
    vi.mocked(searchKnowledgeChunks).mockRejectedValue(new Error("fake sensitive SQL data"));
    const response = await POST(request({ query: "笔记" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "KNOWLEDGE_UNAVAILABLE", message: "知识库服务暂时不可用，请稍后重试。" } });
  });
});
