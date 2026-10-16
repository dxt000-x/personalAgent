// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AgentWorkspace } from "./agent-workspace";

const statuses = [
  { id: "ollama", type: "local", configured: true, availability: "available", model: "fake-ollama" },
  { id: "openrouter", type: "cloud", configured: false, availability: "unavailable", model: "fake-openrouter" },
];

function fakeResponse(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}

let chatResponse: Promise<Response>;
let planResponse: Promise<Response>;
let candidateResponse: Promise<Response>;
let memoryGetResponse: Promise<Response>;
let memoryPostResponse: Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function chatCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === "/api/ai/chat");
}
function planCalls() { return fetchMock.mock.calls.filter(([url]) => url === "/api/agent/plan"); }
const validPlan = {
  version: 1, goal: "完成学习任务",
  steps: [{ id: "step-1", title: "列出目标", description: "确认今天的学习目标。", status: "pending" }],
  requiresConfirmation: true,
};

function candidateCalls() { return fetchMock.mock.calls.filter(([url]) => url === "/api/ai/memory-candidates"); }
function memoryWrites() { return fetchMock.mock.calls.filter(([url, init]) => url === "/api/memories" && init?.method === "POST"); }
const candidate = { content: "我长期使用 TypeScript", category: "preference", importance: 3, reason: "长期偏好" };

async function enableSuggestions() {
  const input = await setup();
  fireEvent.click(screen.getByRole("checkbox", { name: "智能记忆建议" }));
  return input;
}

async function sendMessage(input: HTMLTextAreaElement, text = "我长期使用 TypeScript") {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(chatCalls()).toHaveLength(1));
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
  planResponse = Promise.resolve(fakeResponse({ plan: validPlan }));
  candidateResponse = Promise.resolve(fakeResponse({ candidates: [candidate] }));
  memoryGetResponse = Promise.resolve(fakeResponse({ memories: [] }));
  memoryPostResponse = Promise.resolve(fakeResponse({ memory: { id: "fake" } }));
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/ai/providers") return Promise.resolve(fakeResponse(statuses));
    if (url === "/api/ai/chat" && init?.method === "POST") return chatResponse;
    if (url === "/api/agent/plan" && init?.method === "POST") return planResponse;
    if (url === "/api/ai/memory-candidates" && init?.method === "POST") return candidateResponse;
    if (url === "/api/memories" && init?.method === "POST") return memoryPostResponse;
    if (url === "/api/memories") return memoryGetResponse;
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("explicit Agent Planning", () => {
  it("does not request a plan for an empty or overlong task", async () => {
    const input = await setup();
    const button = screen.getByRole("button", { name: "制定计划" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "   " } });
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "x".repeat(1001) } });
    expect(button.disabled).toBe(true);
    expect(planCalls()).toHaveLength(0);
  });

  it("sends only the current task and selected routing settings to the planning API", async () => {
    const input = await setup();
    fireEvent.change(input, { target: { value: "  制定学习计划  " } });
    fireEvent.change(screen.getByLabelText("自动路由偏好"), { target: { value: "privacy" } });
    fireEvent.click(screen.getByRole("button", { name: "制定计划" }));
    await waitFor(() => expect(planCalls()).toHaveLength(1));
    expect(JSON.parse(String(planCalls()[0][1]?.body))).toEqual({
      provider: "auto", routingPreference: "privacy", messages: [{ role: "user", content: "制定学习计划" }],
    });
    expect(chatCalls()).toHaveLength(0);
  });

  it("shows generating, blocks repeated planning clicks, and leaves ordinary Chat available", async () => {
    let resolvePlan!: (response: Response) => void;
    planResponse = new Promise((resolve) => { resolvePlan = resolve; });
    const input = await setup();
    fireEvent.change(input, { target: { value: "制定学习计划" } });
    fireEvent.click(screen.getByRole("button", { name: "制定计划" }));
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("正在制定计划");
    expect((screen.getByRole("button", { name: "正在制定计划…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "发送消息 ↑" }) as HTMLButtonElement).disabled).toBe(false);
    expect(planCalls()).toHaveLength(1);
    await act(async () => { resolvePlan(fakeResponse({ plan: validPlan })); });
  });

  it("renders the validated plan as text and confirms without executing steps", async () => {
    const input = await setup();
    fireEvent.change(input, { target: { value: "制定学习计划" } });
    fireEvent.click(screen.getByRole("button", { name: "制定计划" }));
    const region = await screen.findByRole("region", { name: "任务计划" });
    expect(within(region).getByText(validPlan.goal)).toBeTruthy();
    expect(within(region).getByText(validPlan.steps[0].title)).toBeTruthy();
    expect(within(region).getByText(validPlan.steps[0].description)).toBeTruthy();
    expect(within(region).getByText("待执行")).toBeTruthy();
    fireEvent.click(within(region).getByRole("button", { name: "确认计划" }));
    expect(within(region).getByText("计划已确认。本阶段不会自动执行步骤。")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url !== "/api/ai/providers" && url !== "/api/agent/plan")).toHaveLength(0);
  });

  it("cancels a pending plan without a network or database operation", async () => {
    const input = await setup();
    fireEvent.change(input, { target: { value: "制定学习计划" } });
    fireEvent.click(screen.getByRole("button", { name: "制定计划" }));
    const region = await screen.findByRole("region", { name: "任务计划" });
    fireEvent.click(within(region).getByRole("button", { name: "取消" }));
    expect(within(region).queryByText(validPlan.goal)).toBeNull();
    expect(within(region).getByText("计划已取消。")).toBeTruthy();
    expect(planCalls()).toHaveLength(1);
  });

  it("shows a fixed error for API failures and never exposes server details", async () => {
    planResponse = Promise.resolve({ ok: false, json: async () => ({ error: { code: "RATE_LIMITED", message: "secret" } }) } as Response);
    const input = await setup();
    fireEvent.change(input, { target: { value: "制定学习计划" } });
    fireEvent.click(screen.getByRole("button", { name: "制定计划" }));
    const region = await screen.findByRole("region", { name: "任务计划" });
    expect(within(region).getByRole("alert").textContent).toContain("请求过于频繁");
    expect(region.textContent).not.toContain("secret");
    expect(chatCalls()).toHaveLength(0);
  });

  it("rejects malformed plan responses instead of displaying raw model data", async () => {
    planResponse = Promise.resolve(fakeResponse({ plan: { ...validPlan, requiresConfirmation: false, debug: "secret" } }));
    const input = await setup();
    fireEvent.change(input, { target: { value: "制定学习计划" } });
    fireEvent.click(screen.getByRole("button", { name: "制定计划" }));
    const region = await screen.findByRole("region", { name: "任务计划" });
    expect(within(region).getByRole("alert").textContent).toContain("模型服务暂时不可用");
    expect(region.textContent).not.toContain("secret");
  });

  it("ignores a late planning response after switching accounts", async () => {
    let resolvePlan!: (response: Response) => void;
    planResponse = new Promise((resolve) => { resolvePlan = resolve; });
    const view = render(<AgentWorkspace sessionKey="user-a" />);
    const input = await screen.findByRole("textbox", { name: "发送消息" });
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: "账号 A 的计划" } });
    fireEvent.click(screen.getByRole("button", { name: "制定计划" }));
    view.rerender(<AgentWorkspace sessionKey="user-b" />);
    await act(async () => { resolvePlan(fakeResponse({ plan: validPlan })); });
    expect(screen.queryByText(validPlan.goal)).toBeNull();
    expect(planCalls()).toHaveLength(1);
  });

  it("keeps the existing Chat submission path unchanged", async () => {
    const input = await setup();
    await sendMessage(input, "普通对话");
    expect(planCalls()).toHaveLength(0);
    expect(JSON.parse(String(chatCalls()[0][1]?.body))).toMatchObject({
      provider: "auto", messages: [{ role: "user", content: "普通对话" }],
    });
  });
});

describe("opt-in memory candidate workflow", () => {
  it("does not start candidate extraction when an old chat resolves after an account switch", async () => {
    let resolveChat!: (response: Response) => void;
    chatResponse = new Promise((resolve) => { resolveChat = resolve; });
    const view = render(<AgentWorkspace sessionKey="user-a" />);
    const input = screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.click(screen.getByRole("checkbox", { name: "智能记忆建议" }));
    await sendMessage(input, "账号 A 的问题");
    view.rerender(<AgentWorkspace sessionKey="user-b" />);
    expect(chatCalls()[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { resolveChat(fakeResponse({ text: "账号 A 的回答", provider: "ollama", model: "fake-ollama" })); });
    expect(candidateCalls()).toHaveLength(0);
    expect(screen.queryByText("账号 A 的回答")).toBeNull();
  });

  it("does not start follow-up network requests after an in-flight chat component unmounts", async () => {
    let resolveChat!: (response: Response) => void;
    chatResponse = new Promise((resolve) => { resolveChat = resolve; });
    const view = render(<AgentWorkspace sessionKey="user-a" />);
    const input = screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.click(screen.getByRole("checkbox", { name: "智能记忆建议" }));
    await sendMessage(input, "待完成的问题");
    view.unmount();
    expect(chatCalls()[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { resolveChat(fakeResponse({ text: "迟到的回答", provider: "ollama", model: "fake-ollama" })); });
    expect(candidateCalls()).toHaveLength(0);
  });
  it("invalidates the old extraction immediately when a new chat starts", async () => {
    let resolveOld!: (response: Response) => void;
    candidateResponse = new Promise((resolve) => { resolveOld = resolve; });
    const input = await enableSuggestions();
    await sendMessage(input, "第一轮消息");
    await waitFor(() => expect(candidateCalls()).toHaveLength(1));

    let resolveSecondChat!: (response: Response) => void;
    chatResponse = new Promise((resolve) => { resolveSecondChat = resolve; });
    fireEvent.change(input, { target: { value: "第二轮消息" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(chatCalls()).toHaveLength(2));
    expect(candidateCalls()[0][1]?.signal?.aborted).toBe(true);
    expect(screen.queryByRole("region", { name: "智能记忆候选" })).toBeNull();

    await act(async () => { resolveOld(fakeResponse({ candidates: [{ ...candidate, content: "旧候选" }] })); });
    expect(screen.queryByRole("region", { name: "智能记忆候选" })).toBeNull();
    expect(memoryWrites()).toHaveLength(0);

    candidateResponse = Promise.resolve(fakeResponse({ candidates: [{ ...candidate, content: "新候选" }] }));
    await act(async () => { resolveSecondChat(fakeResponse({ text: "第二轮回复", provider: "ollama", model: "fake-ollama" })); });
    expect(await within(await screen.findByRole("region", { name: "智能记忆候选" })).findByText("新候选")).toBeTruthy();
    expect(screen.queryByText("旧候选")).toBeNull();
    expect(candidateCalls()).toHaveLength(2);
  });

  it("does not let an older response overwrite a newer candidate", async () => {
    let resolveOld!: (response: Response) => void;
    candidateResponse = new Promise((resolve) => { resolveOld = resolve; });
    const input = await enableSuggestions();
    await sendMessage(input, "第一轮消息");
    await waitFor(() => expect(candidateCalls()).toHaveLength(1));

    candidateResponse = Promise.resolve(fakeResponse({ candidates: [{ ...candidate, content: "新候选" }] }));
    fireEvent.change(input, { target: { value: "第二轮消息" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(candidateCalls()).toHaveLength(2));
    expect(await within(await screen.findByRole("region", { name: "智能记忆候选" })).findByText("新候选")).toBeTruthy();

    await act(async () => { resolveOld(fakeResponse({ candidates: [{ ...candidate, content: "旧候选" }] })); });
    expect(within(screen.getByRole("region", { name: "智能记忆候选" })).getByText("新候选")).toBeTruthy();
    expect(screen.queryByText("旧候选")).toBeNull();
    expect(memoryWrites()).toHaveLength(0);
  });

  it("does not resurrect a pending extraction after suggestions are turned off", async () => {
    let resolveCandidate!: (response: Response) => void;
    candidateResponse = new Promise((resolve) => { resolveCandidate = resolve; });
    const input = await enableSuggestions();
    await sendMessage(input);
    await waitFor(() => expect(candidateCalls()).toHaveLength(1));
    fireEvent.click(screen.getByRole("checkbox", { name: "智能记忆建议" }));
    expect(candidateCalls()[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { resolveCandidate(fakeResponse({ candidates: [candidate] })); });
    expect(screen.queryByRole("region", { name: "智能记忆候选" })).toBeNull();
    expect(memoryWrites()).toHaveLength(0);
  });

  it("does not resurrect a pending extraction after clearing the conversation", async () => {
    let resolveCandidate!: (response: Response) => void;
    candidateResponse = new Promise((resolve) => { resolveCandidate = resolve; });
    const input = await enableSuggestions();
    await sendMessage(input);
    await waitFor(() => expect(candidateCalls()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "清空对话" }));
    await act(async () => { resolveCandidate(fakeResponse({ candidates: [candidate] })); });
    expect(screen.queryByRole("region", { name: "智能记忆候选" })).toBeNull();
    expect(memoryWrites()).toHaveLength(0);
  });

  it("lets an already confirmed save finish after starting a new chat", async () => {
    let resolveMemory!: (response: Response) => void;
    memoryGetResponse = new Promise((resolve) => { resolveMemory = resolve; });
    const input = await enableSuggestions();
    await sendMessage(input);
    expect(await within(await screen.findByRole("region", { name: "智能记忆候选" })).findByText(candidate.content)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));

    candidateResponse = Promise.resolve(fakeResponse({ candidates: [] }));
    fireEvent.change(input, { target: { value: "新聊天" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(chatCalls()).toHaveLength(2));
    await act(async () => { resolveMemory(fakeResponse({ memories: [] })); });
    await waitFor(() => expect(memoryWrites()).toHaveLength(1));
  });

  it("does not start a confirmed save under a replacement account when lookup was pending", async () => {
    let resolveMemory!: (response: Response) => void;
    memoryGetResponse = new Promise((resolve) => { resolveMemory = resolve; });
    const view = render(<AgentWorkspace sessionKey="user-a" />);
    const input = screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.click(screen.getByRole("checkbox", { name: "智能记忆建议" }));
    await sendMessage(input);
    expect(await within(await screen.findByRole("region", { name: "智能记忆候选" })).findByText(candidate.content)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
    view.rerender(<AgentWorkspace sessionKey="user-b" />);
    await act(async () => { resolveMemory(fakeResponse({ memories: [] })); });
    expect(memoryWrites()).toHaveLength(0);
  });

  it("does not apply an old pending response to a replacement account component", async () => {
    let resolveCandidate!: (response: Response) => void;
    candidateResponse = new Promise((resolve) => { resolveCandidate = resolve; });
    const view = render(<AgentWorkspace sessionKey="user-a" />);
    const input = screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.click(screen.getByRole("checkbox", { name: "智能记忆建议" }));
    await sendMessage(input);
    await waitFor(() => expect(candidateCalls()).toHaveLength(1));
    view.rerender(<AgentWorkspace sessionKey="user-b" />);
    await act(async () => { resolveCandidate(fakeResponse({ candidates: [candidate] })); });
    expect(screen.queryByRole("region", { name: "智能记忆候选" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "智能记忆建议" }) as HTMLInputElement).checked).toBe(false);
    expect(memoryWrites()).toHaveLength(0);
  });

  it("is off by default and never analyzes or saves an ordinary chat", async () => {
    const input = await setup();
    await sendMessage(input);
    expect(await screen.findByText("fake reply")).toBeTruthy();
    expect(candidateCalls()).toHaveLength(0);
    expect(memoryWrites()).toHaveLength(0);
  });

  it("analyzes once after the reply and only saves after confirmation", async () => {
    const input = await enableSuggestions();
    await sendMessage(input);
    expect(await screen.findByText("fake reply")).toBeTruthy();
    expect(await within(await screen.findByRole("region", { name: "智能记忆候选" })).findByText(candidate.content)).toBeTruthy();
    expect(screen.getByRole("link", { name: "管理个人记忆" }).getAttribute("href")).toBe("/memory");
    expect(candidateCalls()).toHaveLength(1);
    expect(JSON.parse(String(candidateCalls()[0][1]?.body))).toMatchObject({ message: "我长期使用 TypeScript", provider: "auto" });
    expect(memoryWrites()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
    expect(await screen.findByText("已保存到 Personal Memory")).toBeTruthy();
    expect(memoryWrites()).toHaveLength(1);
    expect(JSON.parse(String(memoryWrites()[0][1]?.body))).toEqual({ content: candidate.content, category: candidate.category, importance: candidate.importance });
  });

  it("ignores a candidate without writing Memory", async () => {
    const input = await enableSuggestions();
    await sendMessage(input);
    expect(await within(await screen.findByRole("region", { name: "智能记忆候选" })).findByText(candidate.content)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "忽略" }));
    expect(screen.queryByRole("region", { name: "智能记忆候选" })).toBeNull();
    expect(memoryWrites()).toHaveLength(0);
  });

  it("retries a failed save, and prevents duplicate clicks while pending", async () => {
    let resolveSave!: (response: Response) => void;
    memoryPostResponse = new Promise((resolve) => { resolveSave = resolve; });
    const input = await enableSuggestions();
    await sendMessage(input);
    expect(await within(await screen.findByRole("region", { name: "智能记忆候选" })).findByText(candidate.content)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "确认保存" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(memoryWrites()).toHaveLength(1));
    resolveSave({ ok: false, json: async () => ({}) } as Response);
    expect(await screen.findByText("保存失败，可重试。")).toBeTruthy();
    memoryPostResponse = Promise.resolve(fakeResponse({ memory: { id: "fake" } }));
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    expect(await screen.findByText("已保存到 Personal Memory")).toBeTruthy();
    expect(memoryWrites()).toHaveLength(2);
  });

  it("rechecks current Memory and skips an existing normalized duplicate", async () => {
    memoryGetResponse = Promise.resolve(fakeResponse({ memories: [{ content: "我 长期使用 TypeScript。" }] }));
    const input = await enableSuggestions();
    await sendMessage(input);
    expect(await within(await screen.findByRole("region", { name: "智能记忆候选" })).findByText(candidate.content)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
    expect(await screen.findByText("已有相同记忆，未重复保存。")).toBeTruthy();
    expect(memoryWrites()).toHaveLength(0);
  });

  it("asks before saving a likely near duplicate and respects cancellation", async () => {
    memoryGetResponse = Promise.resolve(fakeResponse({ memories: [{ content: "我长期使用 TypeScript 开发项目" }] }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const input = await enableSuggestions();
    await sendMessage(input);
    fireEvent.click(await screen.findByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(memoryWrites()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "确认保存" })).toBeTruthy();
    confirm.mockRestore();
  });

  it("saves a likely near duplicate only after explicit confirmation", async () => {
    memoryGetResponse = Promise.resolve(fakeResponse({ memories: [{ content: "我长期使用 TypeScript 开发项目" }] }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const input = await enableSuggestions();
    await sendMessage(input);
    fireEvent.click(await screen.findByRole("button", { name: "确认保存" }));
    expect(await screen.findByText("已保存到 Personal Memory")).toBeTruthy();
    expect(confirm).toHaveBeenCalledOnce();
    expect(memoryWrites()).toHaveLength(1);
    confirm.mockRestore();
  });

  it("treats a server duplicate race as already present", async () => {
    memoryPostResponse = Promise.resolve({ ok: false, status: 409, json: async () => ({ error: { code: "MEMORY_DUPLICATE" } }) } as Response);
    const input = await enableSuggestions();
    await sendMessage(input);
    fireEvent.click(await screen.findByRole("button", { name: "确认保存" }));
    expect(await screen.findByText("已有相同记忆，未重复保存。")).toBeTruthy();
    expect(memoryWrites()).toHaveLength(1);
  });

  it("does not block a successful reply when extraction times out or rerenders", async () => {
    candidateResponse = Promise.resolve({ ok: false, json: async () => ({ error: { code: "TIMEOUT" } }) } as Response);
    const input = await enableSuggestions();
    await sendMessage(input);
    expect(await screen.findByText("fake reply")).toBeTruthy();
    expect(await screen.findByText("本次记忆建议未生成，聊天回复不受影响。")).toBeTruthy();
    fireEvent.change(input, { target: { value: "new draft" } });
    expect(candidateCalls()).toHaveLength(1);
    expect(memoryWrites()).toHaveLength(0);
  });

  it("clears unconfirmed candidates on new task and turns off the feature when session changes", async () => {
    const input = await enableSuggestions();
    await sendMessage(input);
    expect(await within(await screen.findByRole("region", { name: "智能记忆候选" })).findByText(candidate.content)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清空对话" }));
    expect(screen.queryByRole("region", { name: "智能记忆候选" })).toBeNull();
    expect(memoryWrites()).toHaveLength(0);
  });

  it("discards pending candidates and resets opt-in after an account session change", async () => {
    const view = render(<AgentWorkspace sessionKey="user-a" />);
    const input = screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.click(screen.getByRole("checkbox", { name: "智能记忆建议" }));
    await sendMessage(input);
    expect(await within(await screen.findByRole("region", { name: "智能记忆候选" })).findByText(candidate.content)).toBeTruthy();
    view.rerender(<AgentWorkspace sessionKey="user-b" />);
    expect(screen.queryByRole("region", { name: "智能记忆候选" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "智能记忆建议" }) as HTMLInputElement).checked).toBe(false);
    expect(memoryWrites()).toHaveLength(0);
  });

  it("passes Privacy to extraction without changing keyboard behavior", async () => {
    const input = await enableSuggestions();
    fireEvent.change(screen.getByLabelText("自动路由偏好"), { target: { value: "privacy" } });
    fireEvent.change(input, { target: { value: "第一行" } });
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
    fireEvent.change(input, { target: { value: "第一行\n第二行" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(chatCalls()).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(candidateCalls()).toHaveLength(1));
    expect(JSON.parse(String(candidateCalls()[0][1]?.body))).toMatchObject({ routingPreference: "privacy", message: "第一行\n第二行" });
  });

  it("omits Auto Privacy preference for explicit Provider in both chat and extraction", async () => {
    const input = await enableSuggestions();
    fireEvent.change(screen.getByLabelText("自动路由偏好"), { target: { value: "privacy" } });
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "ollama" } });
    expect(screen.getByText(/Privacy 自动路由偏好不生效/)).toBeTruthy();
    await sendMessage(input);
    await waitFor(() => expect(candidateCalls()).toHaveLength(1));
    expect(JSON.parse(String(chatCalls()[0][1]?.body))).toMatchObject({ provider: "ollama" });
    expect(JSON.parse(String(candidateCalls()[0][1]?.body))).toMatchObject({ provider: "ollama" });
    expect(JSON.parse(String(candidateCalls()[0][1]?.body))).not.toHaveProperty("routingPreference");
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Agent chat composer", () => {
  const source = { documentId: "11111111-1111-4111-8111-111111111111", fileName: "guide.txt",
    chunkIndex: 0, snippet: "TCP 安全摘录" };

  it("snapshots the optional knowledge keyword and renders server sources as plain text", async () => {
    chatResponse = Promise.resolve(fakeResponse({ text: "fake reply", provider: "ollama", model: "fake-ollama",
      knowledge: { status: "used", sources: [source] } }));
    const input = await setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "使用我的知识库" }));
    fireEvent.change(screen.getByRole("textbox", { name: "检索关键词" }), { target: { value: " TCP " } });
    await sendMessage(input, "解释 TCP");
    expect(JSON.parse(String(chatCalls()[0][1]?.body)).knowledge).toEqual({ enabled: true, query: "TCP" });
    expect(await screen.findByRole("region", { name: "知识库来源" })).toBeTruthy();
    expect(screen.getByText(source.snippet)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清空对话" }));
    expect(screen.queryByRole("region", { name: "知识库来源" })).toBeNull();
  });

  it("does not send invalid knowledge keywords", async () => {
    const input = await setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "使用我的知识库" }));
    fireEvent.change(screen.getByRole("textbox", { name: "检索关键词" }), { target: { value: "%" } });
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chatCalls()).toHaveLength(0);
  });

  it("shows no-match separately and does not invent a reply or source", async () => {
    chatResponse = Promise.resolve(fakeResponse({ knowledge: { status: "no_match", sources: [] },
      memory: { status: "none", used: false, count: 0 } }));
    const input = await setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "使用我的知识库" }));
    fireEvent.change(screen.getByRole("textbox", { name: "检索关键词" }), { target: { value: "TCP" } });
    await sendMessage(input, "hello");
    expect(await screen.findByText(/没有找到相关知识库片段/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "知识库来源" })).toBeNull();
    expect(candidateCalls()).toHaveLength(0);
  });

  it("drops old sources when the account session changes", async () => {
    chatResponse = Promise.resolve(fakeResponse({ text: "fake reply", provider: "ollama", model: "fake-ollama",
      knowledge: { status: "used", sources: [source] } }));
    const view = render(<AgentWorkspace sessionKey="user-a" />);
    const input = screen.getByRole("textbox", { name: "发送消息" }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.click(screen.getByRole("checkbox", { name: "使用我的知识库" }));
    fireEvent.change(screen.getByRole("textbox", { name: "检索关键词" }), { target: { value: "TCP" } });
    await sendMessage(input, "hello");
    expect(await screen.findByRole("region", { name: "知识库来源" })).toBeTruthy();
    view.rerender(<AgentWorkspace sessionKey="user-b" />);
    expect(screen.queryByRole("region", { name: "知识库来源" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "使用我的知识库" }) as HTMLInputElement).checked).toBe(false);
  });

  it("retries with the original knowledge query snapshot", async () => {
    chatResponse = Promise.resolve({ ok: false, json: async () => ({ error: { code: "KNOWLEDGE_UNAVAILABLE" } }) } as Response);
    const input = await setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "使用我的知识库" }));
    fireEvent.change(screen.getByRole("textbox", { name: "检索关键词" }), { target: { value: "TCP" } });
    await sendMessage(input, "hello");
    expect(await screen.findByText(/知识库检索暂时不可用/)).toBeTruthy();
    chatResponse = Promise.resolve(fakeResponse({ text: "fake reply", provider: "ollama", model: "fake-ollama",
      knowledge: { status: "used", sources: [source] } }));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(chatCalls()).toHaveLength(2));
    expect(JSON.parse(String(chatCalls()[1][1]?.body)).knowledge).toEqual({ enabled: true, query: "TCP" });
  });

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
