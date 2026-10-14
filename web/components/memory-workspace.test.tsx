// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryWorkspace } from "./memory-workspace";
import type { Memory } from "@/lib/memories/types";

function memory(id: string, content = `记忆 ${id}`): Memory {
  return {
    id, user_id: "user-a", content, category: "preference", importance: 3, source: "manual",
    created_at: "2026-10-14T00:00:00Z", updated_at: "2026-10-14T00:00:00Z",
  };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/memories") return json({ memories: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Memory management workspace", () => {
  it("shows the current count and user-saved source, and adds a memory", async () => {
    const existing = memory("existing", "已有记忆");
    const created = memory("created", "新记忆");
    fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
      ? json({ memory: created }, 201) : json({ memories: [existing] }));
    render(<MemoryWorkspace />);
    expect(await screen.findByText("1 / 200 条")).toBeTruthy();
    expect(screen.getAllByText("用户保存")).toHaveLength(2);
    fireEvent.change(screen.getByRole("textbox", { name: "内容" }), { target: { value: "新记忆" } });
    fireEvent.click(screen.getByRole("button", { name: "＋ 添加记忆" }));
    await waitFor(() => expect(screen.getByText("2 / 200 条")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/memories", expect.objectContaining({ method: "POST" }));
  });

  it("disables creation at 200 while leaving existing memories manageable", async () => {
    fetchMock.mockResolvedValue(json({ memories: Array.from({ length: 200 }, (_, index) => memory(`item-${index}`)) }));
    render(<MemoryWorkspace />);
    expect(await screen.findByText("200 / 200 条")).toBeTruthy();
    expect((screen.getByRole("button", { name: "＋ 添加记忆" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("已达到 200 条上限，请先删除不再需要的记忆。")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("shows the API limit error if the server reaches capacity after the list loads", async () => {
    fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
      ? json({ error: { code: "MEMORY_LIMIT_REACHED", message: "已满" } }, 409)
      : json({ memories: [] }));
    render(<MemoryWorkspace />);
    await screen.findByText("0 / 200 条");
    fireEvent.change(screen.getByRole("textbox", { name: "内容" }), { target: { value: "新记忆" } });
    fireEvent.click(screen.getByRole("button", { name: "＋ 添加记忆" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "个人记忆已达到 200 条上限，请先删除不再需要的记忆。");
    expect(screen.getByText("0 / 200 条")).toBeTruthy();
  });

  it("keeps edit and delete available through the existing API", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const original = memory("owned", "旧内容");
    const updated = memory("owned", "新内容");
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === "PATCH") return json({ memory: updated });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url === "/api/memories") return json({ memories: [original] });
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<MemoryWorkspace />);
    await screen.findByText("旧内容");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const editForm = screen.getByRole("heading", { name: "编辑个人记忆" }).closest("form");
    if (!editForm) throw new Error("edit form missing");
    fireEvent.change(within(editForm).getByRole("textbox", { name: "内容" }), { target: { value: "新内容" } });
    fireEvent.click(within(editForm).getByRole("button", { name: "保存修改" }));
    await screen.findByText("新内容");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.getByText("0 / 200 条")).toBeTruthy());
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toContainEqual(["/api/memories/owned", "PATCH"]);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toContainEqual(["/api/memories/owned", "DELETE"]);
  });

  it("aborts and ignores the previous account's delayed list response", async () => {
    let resolveOld!: (response: Response) => void;
    const oldList = new Promise<Response>((resolve) => { resolveOld = resolve; });
    fetchMock.mockImplementationOnce(() => oldList).mockImplementationOnce(async () => json({ memories: [memory("b", "账号 B 记忆")] }));
    const view = render(<MemoryWorkspace key="user-a" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const oldSignal = fetchMock.mock.calls[0][1]?.signal;
    view.rerender(<MemoryWorkspace key="user-b" />);
    expect(oldSignal?.aborted).toBe(true);
    expect(await screen.findByText("账号 B 记忆")).toBeTruthy();
    await act(async () => { resolveOld(json({ memories: [memory("a", "账号 A 记忆")] })); });
    expect(screen.queryByText("账号 A 记忆")).toBeNull();
  });

  it("ignores a delayed save response after an account switch", async () => {
    let resolveSave!: (response: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => { resolveSave = resolve; });
    fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
      ? pendingSave : json({ memories: [] }));
    const view = render(<MemoryWorkspace key="user-a" />);
    await screen.findByText("0 / 200 条");
    fireEvent.change(screen.getByRole("textbox", { name: "内容" }), { target: { value: "账号 A 记忆" } });
    fireEvent.click(screen.getByRole("button", { name: "＋ 添加记忆" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    const oldSignal = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.signal;
    view.rerender(<MemoryWorkspace key="user-b" />);
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { resolveSave(json({ memory: memory("a", "账号 A 记忆") }, 201)); });
    expect(screen.queryByText("账号 A 记忆")).toBeNull();
    expect(await screen.findByText("0 / 200 条")).toBeTruthy();
  });
});
