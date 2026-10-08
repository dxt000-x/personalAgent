// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentWorkspace } from "./agent-workspace";

const statuses = [
  { id: "ollama", type: "local", configured: true, availability: "available", model: "fake-ollama" },
  { id: "openrouter", type: "cloud", configured: false, availability: "unavailable", model: "fake-openrouter" },
];

function fakeResponse(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}

let chatResponse: Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function chatCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === "/api/ai/chat");
}

async function setup() {
  render(<AgentWorkspace />);
  const input = screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  return input;
}

beforeEach(() => {
  let nextId = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `fake-message-${++nextId}` });
  chatResponse = Promise.resolve(fakeResponse({ text: "fake reply", provider: "ollama", model: "fake-ollama" }));
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/ai/providers") return Promise.resolve(fakeResponse(statuses));
    if (url === "/api/ai/chat" && init?.method === "POST") return chatResponse;
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Agent chat composer", () => {
  it("sends once on Enter through the existing chat request path and prevents a newline", async () => {
    const input = await setup();
    fireEvent.change(input, { target: { value: "你好" } });
    const allowDefault = fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
    expect(allowDefault).toBe(false);
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    expect(JSON.parse(String(chatCalls()[0][1]?.body))).toMatchObject({
      provider: "auto", messages: [{ role: "user", content: "你好" }],
    });
    expect(input.value).toBe("");
  });

  it("keeps Shift+Enter for a multiline draft without sending", async () => {
    const input = await setup();
    fireEvent.change(input, { target: { value: "第一行" } });
    const allowDefault = fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: true });
    expect(allowDefault).toBe(true);
    expect(chatCalls()).toHaveLength(0);
    // The browser inserts the newline after the uncancelled keydown.
    fireEvent.change(input, { target: { value: "第一行\n第二行" } });
    expect(input.value).toBe("第一行\n第二行");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    expect(JSON.parse(String(chatCalls()[0][1]?.body)).messages[0].content).toBe("第一行\n第二行");
  });

  it("does not send while the Chinese IME is composing or reports keyCode 229", async () => {
    const input = await setup();
    fireEvent.change(input, { target: { value: "ni" } });
    fireEvent.compositionStart(input);
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 13 })).toBe(true);
    expect(chatCalls()).toHaveLength(0);
    fireEvent.compositionEnd(input);
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: false, keyCode: 229 })).toBe(true);
    expect(chatCalls()).toHaveLength(0);
    fireEvent.change(input, { target: { value: "你" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
  });

  it("does not send empty or whitespace-only drafts", async () => {
    const input = await setup();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "  \n  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chatCalls()).toHaveLength(0);
    expect((screen.getByRole("button", { name: "发送消息 ↑" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not send again while the first AI request is pending", async () => {
    let resolveChat!: (response: Response) => void;
    chatResponse = new Promise<Response>((resolve) => { resolveChat = resolve; });
    const input = await setup();
    fireEvent.change(input, { target: { value: "只发送一次" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "AI 正在响应…" }));
    expect(chatCalls()).toHaveLength(1);
    expect(input.disabled).toBe(true);
    resolveChat(fakeResponse({ text: "fake reply", provider: "ollama", model: "fake-ollama" }));
    await waitFor(() => expect(input.disabled).toBe(false));
  });

  it("preserves the send button", async () => {
    const input = await setup();
    fireEvent.change(input, { target: { value: "按钮消息" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息 ↑" }));
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    expect(JSON.parse(String(chatCalls()[0][1]?.body)).messages[0].content).toBe("按钮消息");
    expect(screen.getByText(/Enter 发送 · Shift\+Enter 换行/)).toBeTruthy();
  });

  it("shows a clear UTC reset message when cloud quota is exhausted", async () => {
    chatResponse = Promise.resolve({
      ok: false,
      json: async () => ({ error: { code: "CLOUD_QUOTA_EXCEEDED" } }),
    } as Response);
    const input = await setup();
    fireEvent.change(input, { target: { value: "测试云额度提示" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("今日云端 AI 使用次数已达到上限，请于下一个 UTC 日期重置后再试。")).toBeTruthy();
    expect(chatCalls()).toHaveLength(1);
  });
});
