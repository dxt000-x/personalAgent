import { describe, expect, it, vi } from "vitest";
import { searchKnowledgeChunks, validateSearchInput } from "./search";
import { MAX_SEARCH_RESULTS, MAX_SEARCH_SNIPPET_CHARS, MAX_SEARCH_TOTAL_CHARS } from "./search-types";

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const documentA = "11111111-1111-4111-8111-111111111111";
const documentB = "22222222-2222-4222-8222-222222222222";

type Row = { document_id: string; user_id: string; chunk_index: number; content: string;
  knowledge_documents: { file_name: string; status: string; user_id: string; storage_path: string } };

function row(user_id: string, document_id: string, content: string, status = "ready", chunk_index = 0): Row {
  return { user_id, document_id, content, chunk_index,
    knowledge_documents: { file_name: `${user_id === userA ? "A" : "B"}.txt`, status, user_id,
      storage_path: "private-path-do-not-return" } };
}

function fakeClient(sessionUser: string, rows: Row[], failure = false) {
  const filters: [string, unknown][] = [];
  const select = vi.fn(() => builder);
  const from = vi.fn(() => ({ select }));
  let maxRows = 1000;
  let pattern = "";
  const builder = {
    eq: vi.fn((key: string, value: unknown) => { filters.push([key, value]); return builder; }),
    ilike: vi.fn((_key: string, value: string) => { pattern = value; return builder; }),
    order: vi.fn(() => builder),
    limit: vi.fn((value: number) => { maxRows = value; return builder; }),
    abortSignal: vi.fn(async () => failure ? { data: null, error: { message: "fake private SQL detail" } }
      : { data: rows.filter((item) => item.user_id === sessionUser &&
          filters.every(([key, value]) => key === "user_id" ? item.user_id === value
            : key === "knowledge_documents.user_id" ? item.knowledge_documents.user_id === value
              : key === "knowledge_documents.status" ? item.knowledge_documents.status === value
                : key === "document_id" ? item.document_id === value : false) &&
          item.content.toLocaleLowerCase().includes(pattern.slice(1, -1).toLocaleLowerCase()))
        .slice(0, maxRows), error: null }),
  };
  return { client: { from } as never, from, select, builder, filters };
}

describe("bounded authenticated knowledge keyword search", () => {
  it("accepts English and Chinese literal words while rejecting empty, long, wildcard and ownership input", () => {
    expect(validateSearchInput({ query: "  机器学习  " })).toEqual({ query: "机器学习" });
    expect(validateSearchInput({ query: "machine learning", documentId: documentA }))
      .toEqual({ query: "machine learning", documentId: documentA });
    for (const value of [{ query: " " }, { query: "a".repeat(101) }, { query: "%" },
      { query: "_" }, { query: "*" }, { query: "\\" }, { query: "a", user_id: userB },
      { query: "a", documentId: "" }, { query: "a", documentId: "not-uuid" },
      { query: "a", documentId: 123 }, { query: "a", documentId: [] },
      { query: 4 }, [], null]) {
      expect(() => validateSearchInput(value)).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
    }
  });

  it("normalizes a valid uppercase documentId before comparing the database's canonical UUID", async () => {
    const uppercase = "A1B2C3D4-E5F6-4A7B-8C9D-A1B2C3D4E5F6";
    const canonical = uppercase.toLowerCase();
    const input = validateSearchInput({ query: "shared", documentId: uppercase });
    expect(input).toEqual({ query: "shared", documentId: canonical });
    const fake = fakeClient(userA, [row(userA, canonical, "shared")]);
    expect(await searchKnowledgeChunks(fake.client, userA, input.query, input.documentId))
      .toEqual([{ documentId: canonical, fileName: "A.txt", chunkIndex: 0, snippet: "shared" }]);
    expect(fake.filters).toContainEqual(["document_id", canonical]);
  });

  it("preserves lowercase documentId input and leaves an unscoped search unchanged", () => {
    expect(validateSearchInput({ query: "shared", documentId: documentA }))
      .toEqual({ query: "shared", documentId: documentA });
    expect(validateSearchInput({ query: "shared" })).toEqual({ query: "shared" });
    expect(() => validateSearchInput({ query: "shared", documentId: "INVALID-UUID" }))
      .toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("pushes documentId into the database query while retaining ownership and ready filters", async () => {
    const rows = [row(userA, documentA, "shared"), row(userA, documentB, "shared"),
      row(userB, documentB, "shared")];
    const scoped = fakeClient(userA, rows);
    expect(await searchKnowledgeChunks(scoped.client, userA, "shared", documentA))
      .toEqual([{ documentId: documentA, fileName: "A.txt", chunkIndex: 0, snippet: "shared" }]);
    expect(scoped.filters).toEqual([["user_id", userA], ["knowledge_documents.user_id", userA],
      ["knowledge_documents.status", "ready"], ["document_id", documentA]]);
    expect(await searchKnowledgeChunks(fakeClient(userA, rows).client, userA, "shared", documentB)).toHaveLength(1);
    expect(await searchKnowledgeChunks(fakeClient(userB, rows).client, userB, "shared", documentA)).toEqual([]);
    expect(await searchKnowledgeChunks(fakeClient(userA, rows).client, userA, "shared",
      "33333333-3333-4333-8333-333333333333")).toEqual([]);
  });

  it("keeps non-ready documents outside scoped results", async () => {
    const rows = [row(userA, documentA, "shared", "failed"), row(userA, documentA, "shared", "processing")];
    expect(await searchKnowledgeChunks(fakeClient(userA, rows).client, userA, "shared", documentA)).toEqual([]);
  });

  it("queries only current user's ready chunks and returns minimal fields", async () => {
    const fake = fakeClient(userA, [row(userA, documentA, "机器学习笔记"), row(userB, documentB, "机器学习秘密"),
      row(userA, documentA, "机器学习草稿", "processing", 1)]);
    const results = await searchKnowledgeChunks(fake.client, userA, "机器学习");
    expect(results).toEqual([{ documentId: documentA, fileName: "A.txt", chunkIndex: 0, snippet: "机器学习笔记" }]);
    expect(JSON.stringify(results)).not.toContain("storage_path");
    expect(JSON.stringify(results)).not.toContain("private-path-do-not-return");
    expect(fake.from).toHaveBeenCalledOnce();
    expect(fake.from).toHaveBeenCalledWith("knowledge_chunks");
    expect(fake.select).toHaveBeenCalledWith("document_id,chunk_index,content,knowledge_documents!inner(file_name,status,user_id)");
    expect(fake.filters).toEqual([["user_id", userA], ["knowledge_documents.user_id", userA], ["knowledge_documents.status", "ready"]]);
    expect(fake.builder.ilike).toHaveBeenCalledWith("content", "%机器学习%");
    expect(fake.builder.limit).toHaveBeenCalledWith(MAX_SEARCH_RESULTS);
    expect(fake.builder.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("isolates A and B using different sessions even for the same keyword", async () => {
    const rows = [row(userA, documentA, "同一个关键词 A"), row(userB, documentB, "同一个关键词 B")];
    expect((await searchKnowledgeChunks(fakeClient(userA, rows).client, userA, "同一个关键词"))[0].fileName).toBe("A.txt");
    expect((await searchKnowledgeChunks(fakeClient(userB, rows).client, userB, "同一个关键词"))[0].fileName).toBe("B.txt");
    expect(await searchKnowledgeChunks(fakeClient(userB, rows).client, userA, "同一个关键词")).toEqual([]);
  });

  it("excludes uploading, processing, failed, and deleting documents", async () => {
    const rows = ["uploading", "processing", "failed", "deleting", "ready"]
      .map((status, index) => row(userA, documentA, "keyword", status, index));
    expect(await searchKnowledgeChunks(fakeClient(userA, rows).client, userA, "keyword"))
      .toEqual([{ documentId: documentA, fileName: "A.txt", chunkIndex: 4, snippet: "keyword" }]);
  });

  it("caps result count, each snippet, and total returned text", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(userA, documentA, `keyword${"x".repeat(1100)}`, "ready", i));
    const results = await searchKnowledgeChunks(fakeClient(userA, rows).client, userA, "keyword");
    expect(results).toHaveLength(MAX_SEARCH_RESULTS);
    expect(results.every((item) => item.snippet.length <= MAX_SEARCH_SNIPPET_CHARS)).toBe(true);
    expect(results.reduce((count, item) => count + item.snippet.length, 0)).toBeLessThanOrEqual(MAX_SEARCH_TOTAL_CHARS);
  });

  it("fails safely for a database error or malformed cross-user row", async () => {
    await expect(searchKnowledgeChunks(fakeClient(userA, [], true).client, userA, "keyword"))
      .rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE" });
    const malicious = fakeClient(userA, [row(userA, documentA, "keyword")]);
    malicious.builder.abortSignal.mockResolvedValueOnce({ data: [row(userB, documentB, "keyword")], error: null });
    await expect(searchKnowledgeChunks(malicious.client, userA, "keyword"))
      .rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE" });
  });
});
