// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {SettingsPanel} from "./settings-panel";
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
const safe=[{id:"openai",configured:true,availability:"unknown",model:"secret-canary",apiKey:"secret-canary"},{id:"ollama",configured:true,availability:"available"}];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(()=>{fetchMock=vi.fn().mockResolvedValue(Response.json(safe));vi.stubGlobal("fetch",fetchMock)});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it("shows allowlisted read-only status without exposing raw configuration",async()=>{
 render(<SettingsPanel/>);await screen.findByText("已配置 · 健康状态未知");expect(screen.getByText("已配置 · 当前可用")).toBeTruthy();
 expect(document.body.textContent).not.toContain("secret-canary");expect(screen.queryByRole("textbox")).toBeNull();
 expect(fetchMock).toHaveBeenCalledWith("/api/ai/providers",expect.objectContaining({cache:"no-store"}));
});
it("offers refresh for service errors and requires login after 401",async()=>{
 fetchMock.mockResolvedValueOnce(Response.json({error:{message:"secret-canary"}},{status:503}));render(<SettingsPanel/>);
 await screen.findByRole("alert");expect(document.body.textContent).not.toContain("secret-canary");
 fireEvent.click(screen.getByRole("button",{name:"刷新配置状态"}));await screen.findByText("已配置 · 健康状态未知");
 fetchMock.mockResolvedValueOnce(new Response(null,{status:401}));fireEvent.click(screen.getByRole("button",{name:"刷新配置状态"}));
 await screen.findByRole("link",{name:"重新登录"});expect(screen.getByRole("button",{name:"刷新配置状态"})).toHaveProperty("disabled",true);
});
it("keeps preview choices local and never pretends to save",async()=>{
 render(<SettingsPanel/>);await screen.findByText("已配置 · 健康状态未知");fireEvent.click(screen.getByText("设置界面预览 · 不保存、不影响实际行为"));
 fireEvent.click(screen.getByRole("radio",{name:"openai"}));expect(screen.getByText(/当前预览：openai/)).toBeTruthy();
 expect(screen.getByRole("button",{name:"保存设置 · 尚未开放"})).toHaveProperty("disabled",true);
 fireEvent.click(screen.getByRole("button",{name:"重置预览"}));await screen.findByText("预览已重置，未保存任何设置。");expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("aborts a pending status read on unmount",async()=>{
 fetchMock.mockImplementation(()=>new Promise(()=>{}));const view=render(<SettingsPanel/>);await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
 const signal=fetchMock.mock.calls[0][1].signal;view.unmount();expect(signal.aborted).toBe(true);
});
