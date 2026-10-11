// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KnowledgeSearch } from "./knowledge-search";

const result = { documentId: "doc-a", fileName: "notes.txt", chunkIndex: 0, snippet: "机器学习笔记" };
let fetchMock: ReturnType<typeof vi.fn>;

function response(results: unknown[], status = 200): Response {
  return { ok: status < 400, status, json: async () => ({ results }) } as Response;
}

beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function submit(query: string) {
  fireEvent.change(screen.getByLabelText("知识库搜索关键词"), { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
}

describe("KnowledgeSearch", () => {
  it("shows loading, results, and an empty result without rendering HTML", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    render(<KnowledgeSearch />);
    submit("机器学习");
    expect(screen.getByRole("status").textContent).toContain("检索");
    expect(fetchMock).toHaveBeenCalledWith("/api/knowledge/search", expect.objectContaining({
      method: "POST", cache: "no-store", body: JSON.stringify({ query: "机器学习" }),
    }));
    resolve(response([{ ...result, snippet: "<script>unsafe</script>" }]));
    expect(await screen.findByText("<script>unsafe</script>")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    fetchMock.mockResolvedValueOnce(response([]));
    submit("笔记");
    expect(await screen.findByText("没有找到匹配片段。")).toBeTruthy();
  });

  it("shows a safe error for failed search and rejects invalid input without a request", async () => {
    fetchMock.mockResolvedValueOnce(response([], 503));
    render(<KnowledgeSearch />);
    submit("笔记");
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "检索暂时不可用，请稍后重试。");
    submit("%_");
    expect(screen.getByRole("alert").textContent).toContain("关键词");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("ignores an old response after the query changes", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    render(<KnowledgeSearch />);
    submit("旧查询");
    fireEvent.change(screen.getByLabelText("知识库搜索关键词"), { target: { value: "新查询" } });
    resolve(response([result]));
    await waitFor(() => expect(screen.queryByText("机器学习笔记")).toBeNull());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("aborts pending work when the component unmounts", () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const { unmount } = render(<KnowledgeSearch />);
    submit("测试");
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
