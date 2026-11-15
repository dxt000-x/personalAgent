// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, LanguageSwitcher } from "./i18n-provider";
import { MemoryWorkspace } from "./memory-workspace";
import { KnowledgeWorkspace } from "./knowledge-workspace";
import { AgentWorkspace } from "./agent-workspace";
import { SettingsPanel } from "./settings-panel";
import { AuthForm } from "./auth-form";
import Dashboard from "@/app/(workspace)/page";
import { preferenceKey } from "@/lib/i18n/core";
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => null }));
const user = "locale-test-account";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear(); vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/ai/providers") return Response.json([{ id: "ollama", type: "local", configured: true, availability: "available", model: "fixture" }]);
    if (url === "/api/memories") return Response.json({ memories: [] });
    if (url === "/api/knowledge") return Response.json({ documents: [] });
    if (url === "/api/knowledge/classifications") return Response.json({ classifications: [] });
    throw Error("UNEXPECTED_OFFLINE_REQUEST");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("all workspace screens use the active locale (mocked APIs)", () => {
  it.each([
    ["Dashboard", <Dashboard key="dashboard" />, "从一个问题开始", "Start with a question"],
    ["Memory", <MemoryWorkspace key="memory" />, "个人记忆", "Personal memory"],
    ["Knowledge", <KnowledgeWorkspace key="knowledge" />, "知识分类与知识点", "Knowledge categories and concepts"],
    ["Agent", <AgentWorkspace key="agent" />, "制定计划", "Create plan"],
    ["Settings", <SettingsPanel key="settings" />, "模型服务配置状态 · 只读", "Model configuration status · Read only"],
    ["Login", <AuthForm key="login" mode="login" configured />, "欢迎回来", "Welcome back"],
  ])("switches %s immediately without remounting or repeating requests", async (_name, component, chinese, english) => {
    render(<I18nProvider userId={user}><LanguageSwitcher />{component}</I18nProvider>);
    expect(await screen.findAllByText(chinese as string)).not.toHaveLength(0);
    // Settle initial list/provider loads before comparing network calls.
    await waitFor(() => expect(screen.queryByText("正在读取文档…")).toBeNull());
    const calls = fetchMock.mock.calls.length;
    fireEvent.change(screen.getAllByLabelText("界面语言")[0], { target: { value: "en" } });
    expect(await screen.findAllByText(english as string)).not.toHaveLength(0);
    expect(fetchMock.mock.calls).toHaveLength(calls);
    expect(localStorage.getItem(preferenceKey(user))).toBe("en");
  });
  it("keeps unsaved memory text and translates form labels in place", async () => {
    render(<I18nProvider userId={user}><LanguageSwitcher /><MemoryWorkspace /></I18nProvider>);
    await screen.findByText("0 / 200 条");
    const input = screen.getByRole("textbox", { name: "内容" });
    fireEvent.change(input, { target: { value: "我的原文 Database" } });
    fireEvent.change(screen.getByLabelText("界面语言"), { target: { value: "en" } });
    expect(screen.getByRole("textbox", { name: "Content" })).toBe(input);
    expect(input).toHaveProperty("value", "我的原文 Database");
  });
});
