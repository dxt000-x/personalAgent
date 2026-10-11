// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KnowledgeWorkspace } from "./knowledge-workspace";
import { createClient } from "@/lib/supabase/client";
import type { KnowledgeDocument } from "@/lib/knowledge/types";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

const document: KnowledgeDocument = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  file_name: "notes.txt", file_type: "txt", byte_size: 10,
  storage_path: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/11111111-1111-4111-8111-111111111111/source.txt",
  status: "uploading", failure_kind: null, processing_generation: 0, chunk_count: 0,
  created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z",
};

const uploadFile = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;
let stored: KnowledgeDocument[];
let searchResponse: () => Promise<Response>;
let deleteFails: boolean;
let processFails: boolean;
const searchResult = { documentId: document.id, fileName: document.file_name,
  chunkIndex: 0, snippet: "过期摘录内容" };

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

beforeEach(() => {
  vi.resetAllMocks();
  stored = [];
  searchResponse = async () => json({ results: [searchResult] });
  deleteFails = false;
  processFails = false;
  const fakeClient = { storage: { from: vi.fn(() => ({ upload: uploadFile })) } };
  vi.mocked(createClient).mockReturnValue(fakeClient as unknown as NonNullable<ReturnType<typeof createClient>>);
  uploadFile.mockResolvedValue({ error: null });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/knowledge/search" && init?.method === "POST") return searchResponse();
    if (url === "/api/knowledge" && !init?.method) return json({ documents: stored });
    if (url === "/api/knowledge" && init?.method === "POST") {
      stored = [{ ...document }];
      return json({ document, upload: { bucket: "knowledge-files", path: document.storage_path, contentType: "text/plain" } }, 201);
    }
    if (url === `/api/knowledge/${document.id}/process`) {
      if (processFails) return json({ error: { message: "处理暂时失败。" } }, 503);
      stored = [{ ...document, status: "ready", chunk_count: 1 }];
      return json({ document: stored[0] });
    }
    if (url === `/api/knowledge/${document.id}` && init?.method === "DELETE") {
      if (deleteFails) return json({ error: { message: "删除暂时失败。" } }, 503);
      stored = [];
      return { ok: true, status: 204 } as Response;
    }
    throw new Error("Unexpected fake request");
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("KnowledgeWorkspace", () => {
  async function showSearchResult() {
    fireEvent.change(screen.getByLabelText("知识库搜索关键词"), { target: { value: "过期" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByText(searchResult.snippet)).toBeTruthy();
  }

  it("shows an empty state, uploads directly to private Storage, then finalizes", async () => {
    render(<KnowledgeWorkspace />);
    expect(await screen.findByText(/还没有上传文档/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("选择知识库文件"), {
      target: { files: [new File(["valid text"], "notes.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(screen.getByText("文件已上传并完成正文解析。")).toBeTruthy());
    expect(uploadFile).toHaveBeenCalledWith(document.storage_path, expect.any(File),
      { contentType: "text/plain", upsert: false });
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls.indexOf("/api/knowledge")).toBeLessThan(urls.indexOf(`/api/knowledge/${document.id}/process`));
    expect(screen.getByText("已就绪")).toBeTruthy();
  });

  it("rejects an empty file before contacting the API or Storage", async () => {
    render(<KnowledgeWorkspace />);
    await screen.findByText(/还没有上传文档/);
    fireEvent.change(screen.getByLabelText("选择知识库文件"), {
      target: { files: [new File([], "empty.md")] },
    });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "文件不能为空。");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("cleans up a pending row when direct Storage upload fails", async () => {
    uploadFile.mockResolvedValue({ error: { message: "private storage failure" } });
    render(<KnowledgeWorkspace />);
    await screen.findByText(/还没有上传文档/);
    fireEvent.change(screen.getByLabelText("选择知识库文件"), {
      target: { files: [new File(["valid text"], "notes.txt")] },
    });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "文件上传失败，请检查网络后重试。");
    expect(fetchMock).toHaveBeenCalledWith(`/api/knowledge/${document.id}`, { method: "DELETE" });
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/process"))).toBe(false);
  });

  it("deletes from the list after confirmation", async () => {
    stored = [{ ...document, status: "ready", chunk_count: 1 }];
    render(<KnowledgeWorkspace />);
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.getByText("文档已删除。")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(`/api/knowledge/${document.id}`, { method: "DELETE" });
  });
  it("offers a real retry action for a temporarily failed document", async () => {
    stored = [{ ...document, status: "failed", failure_kind: "temporary" }];
    render(<KnowledgeWorkspace />);
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "重试处理" }));
    await waitFor(() => expect(screen.getByText("文档处理完成。")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(`/api/knowledge/${document.id}/process`, { method: "POST" });
  });

  it("clears an existing search result after successful deletion", async () => {
    stored = [{ ...document, status: "ready", chunk_count: 1 }];
    render(<KnowledgeWorkspace />);
    await screen.findByText("notes.txt");
    await showSearchResult();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await screen.findByText("文档已删除。");
    expect(screen.queryByText(searchResult.snippet)).toBeNull();
    expect(screen.getByLabelText("知识库搜索关键词")).toHaveProperty("value", "");
  });

  it("ignores a pending search response after successful deletion", async () => {
    stored = [{ ...document, status: "ready", chunk_count: 1 }];
    let resolve!: (value: Response) => void;
    searchResponse = () => new Promise<Response>((done) => { resolve = done; });
    render(<KnowledgeWorkspace />);
    await screen.findByText("notes.txt");
    fireEvent.change(screen.getByLabelText("知识库搜索关键词"), { target: { value: "过期" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const signal = fetchMock.mock.calls.find(([url]) => url === "/api/knowledge/search")?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await screen.findByText("文档已删除。");
    expect(signal.aborted).toBe(true);
    resolve(json({ results: [searchResult] }));
    await waitFor(() => expect(screen.queryByText(searchResult.snippet)).toBeNull());
  });

  it("invalidates old results after successful upload and processing", async () => {
    stored = [{ ...document, status: "ready", chunk_count: 1 }];
    render(<KnowledgeWorkspace />);
    await screen.findByText("notes.txt");
    await showSearchResult();
    fireEvent.change(screen.getByLabelText("选择知识库文件"), {
      target: { files: [new File(["new text"], "new.txt", { type: "text/plain" })] },
    });
    await screen.findByText("文件已上传并完成正文解析。");
    expect(screen.queryByText(searchResult.snippet)).toBeNull();
  });

  it("invalidates old results after successful processing retry", async () => {
    stored = [{ ...document, status: "failed", failure_kind: "temporary" }];
    render(<KnowledgeWorkspace />);
    await screen.findByText("notes.txt");
    await showSearchResult();
    fireEvent.click(screen.getByRole("button", { name: "重试处理" }));
    await screen.findByText("文档处理完成。");
    expect(screen.queryByText(searchResult.snippet)).toBeNull();
  });

  it("keeps search results and shows an error when deletion fails", async () => {
    stored = [{ ...document, status: "ready", chunk_count: 1 }];
    deleteFails = true;
    render(<KnowledgeWorkspace />);
    await screen.findByText("notes.txt");
    await showSearchResult();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "删除暂时失败。");
    expect(screen.queryByText("文档已删除。")).toBeNull();
    expect(screen.getByText(searchResult.snippet)).toBeTruthy();
  });

  it("does not report processing success when retry fails", async () => {
    stored = [{ ...document, status: "failed", failure_kind: "temporary" }];
    processFails = true;
    render(<KnowledgeWorkspace />);
    await screen.findByText("notes.txt");
    await showSearchResult();
    fireEvent.click(screen.getByRole("button", { name: "重试处理" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "处理暂时失败。");
    expect(screen.queryByText("文档处理完成。")).toBeNull();
    expect(screen.getByText(searchResult.snippet)).toBeTruthy();
  });
});
