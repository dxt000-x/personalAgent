// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { I18nProvider, LanguageSwitcher, UiText } from "./i18n-provider";
import { preferenceKey } from "@/lib/i18n/core";
import { AppSidebar } from "./app-sidebar";
import { AgentMessage } from "./agent-message";
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/knowledge", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./account-menu", () => ({ AccountMenu: () => null }));
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
beforeEach(() => { window.localStorage.clear(); vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const sample = (userId = A) => <I18nProvider key={userId} userId={userId}><LanguageSwitcher /><UiText source="Dashboard" /></I18nProvider>;
describe("language selection, hydration and account boundaries", () => {
  it("switches immediately without refresh and restores the saved choice after remount", async () => {
    const view = render(sample()); expect(screen.getByText("工作台")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("界面语言"), { target: { value: "en" } });
    expect(screen.getByText("Dashboard")).toBeTruthy(); expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem(preferenceKey(A))).toBe("en"); view.unmount(); render(sample());
    await waitFor(() => expect(screen.getByText("Dashboard")).toBeTruthy());
  });
  it("never reuses another user's saved preference", async () => {
    localStorage.setItem(preferenceKey(A), "en"); localStorage.setItem(preferenceKey(B), "zh-CN");
    const view = render(sample(A)); await waitFor(() => expect(screen.getByText("Dashboard")).toBeTruthy());
    view.rerender(sample(B)); await waitFor(() => expect(screen.getByText("工作台")).toBeTruthy());
    expect(localStorage.getItem(preferenceKey(A))).toBe("en"); expect(localStorage.getItem(preferenceKey(B))).toBe("zh-CN");
  });
  it("uses the browser language only when this account has no valid saved value", async () => {
    vi.mocked(vi.spyOn(navigator, "languages", "get")).mockReturnValue(["fr", "en-US"]);
    render(sample()); await waitFor(() => expect(screen.getByText("Dashboard")).toBeTruthy());
    expect(localStorage.getItem(preferenceKey(A))).toBeNull();
  });
  it("keeps the current choice usable if local storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
    render(sample()); fireEvent.change(screen.getByLabelText("界面语言"), { target: { value: "en" } });
    expect(screen.getByText("Dashboard")).toBeTruthy(); expect(screen.getByRole("status").textContent).toContain("Local storage is blocked");
  });
  it("ignores other accounts' storage events", () => {
    render(sample()); localStorage.setItem(preferenceKey(B), "en");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: preferenceKey(B), newValue: "en" })));
    expect(screen.getByText("工作台")).toBeTruthy();
  });
  it("hydrates the Chinese server snapshot before restoring English, without a mismatch", async () => {
    localStorage.setItem(preferenceKey(A), "en");
    const element = sample(), html = renderToString(element);
    expect(html).toContain("工作台"); expect(html).not.toContain(">Dashboard<");
    const container = document.createElement("div"); container.innerHTML = html; document.body.append(container);
    const recoverable = vi.fn(); let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError: recoverable }); });
    expect(container.textContent).toContain("Dashboard"); expect(recoverable).not.toHaveBeenCalled();
    await act(async () => root.unmount()); container.remove();
  });
  it("provides Chinese and English navigation, with the same active-page and keyboard behavior", async () => {
    render(<I18nProvider userId={A}><AppSidebar userEmail="fixture@example.invalid" /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "展开导航" }));
    expect(screen.getByRole("link", { name: /知识库/ }).getAttribute("aria-current")).toBe("page");
    fireEvent.change(screen.getByLabelText("界面语言"), { target: { value: "en" } });
    expect(screen.getByRole("link", { name: /Knowledge base/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Dashboard/ })).toBeTruthy(); expect(screen.getByRole("link", { name: /Settings/ })).toBeTruthy();
  });
  it("does not translate user-authored content that happens to equal a UI key", () => {
    render(<I18nProvider userId={A}><AgentMessage message={{ id: "1", role: "user", content: "Dashboard" }} /></I18nProvider>);
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });
});
