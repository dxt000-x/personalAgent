// @vitest-environment jsdom
import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { KnowledgeTraining } from "./knowledge-training";
import { I18nProvider,LanguageSwitcher } from "./i18n-provider";
import { buildTrainingPack } from "@/lib/knowledge/training";
import { trainingDoc as doc,trainingOwner as owner,trainingChunks as chunks } from "@/lib/knowledge/training-fixtures";
import { createClient } from "@/lib/supabase/client";
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock("@/lib/supabase/client",()=>({createClient:vi.fn(()=>null)}));
let fetchMock:ReturnType<typeof vi.fn>;
const pack=()=>buildTrainingPack(doc,chunks);
const catalog=()=>({ownerId:owner,items:[{id:doc.id,fileName:doc.file_name,domain:"computing",topics:pack().topics,unavailable:false}],nextOffset:null});
function view(){return <I18nProvider userId={owner}><LanguageSwitcher/><KnowledgeTraining userId={owner}/></I18nProvider>;}
async function load(){render(view());await screen.findByRole("button",{name:/study.md/u});fireEvent.click(screen.getByRole("button",{name:/study.md/u}));await screen.findByText("规则生成；题目与答案关联原文，不代表模型训练或微调。");}
beforeEach(()=>{localStorage.clear();vi.spyOn(navigator,"languages","get").mockReturnValue(["zh-CN"]);fetchMock=vi.fn(async(_url:string,options?:RequestInit)=>Response.json(options?.method==="POST"?{pack:pack()}:catalog()));vi.stubGlobal("fetch",fetchMock);vi.mocked(createClient).mockReturnValue(null);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("training workspace mocked APIs and responsive DOM",()=>{
 it("loads rules without classification-storage calls and shows source links",async()=>{await load();expect(fetchMock.mock.calls.every(c=>String(c[0]).startsWith("/api/knowledge/training"))).toBe(true);expect(screen.getByText("学习记录仅保留在当前页面会话；刷新或离开页面后清除，不会永久保存。")).toBeTruthy();expect(screen.getByRole("link",{name:"返回原始文档"}).getAttribute("href")).toBe(`/knowledge#knowledge-document-${doc.id}`);expect(screen.getByText("查看原文与来源")).toBeTruthy();});
 it("empty knowledge library gives next step",async()=>{fetchMock.mockResolvedValue(Response.json({ownerId:owner,items:[],nextOffset:null}));render(view());expect(await screen.findByText("没有可训练文档；请上传并完成解析，或调整分类筛选。")).toBeTruthy();expect(screen.getByRole("link",{name:"管理知识库"})).toBeTruthy();});
 it("generates single choice, checks answer, and reviews mistakes",async()=>{await load();fireEvent.click(screen.getByRole("button",{name:"章节测试"}));const q=pack().questions[0];const wrong=q.options.find(o=>o.id!==q.answer)!;fireEvent.click(screen.getByRole("radio",{name:wrong.term||"以上均不匹配"}));fireEvent.click(screen.getByRole("button",{name:"核对答案"}));expect(await screen.findByText("需要复习")).toBeTruthy();expect((screen.getByRole("button",{name:"核对答案"}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole("button",{name:"错题复习"}));expect(screen.getByRole("radio",{name:wrong.term||"以上均不匹配"})).toBeTruthy();});
 it("Q&A card reveals exact source answer",async()=>{await load();fireEvent.click(screen.getByRole("button",{name:"问答卡片"}));const reveal=screen.getByRole("button",{name:"显示参考答案"});fireEvent.click(reveal);expect(screen.queryByRole("button",{name:"显示参考答案"})).toBeNull();expect(screen.getAllByText((_text, node) => node?.tagName === "BLOCKQUOTE" && node.textContent === pack().points[0].quote).length).toBeGreaterThan(0);});
 it("domain filters only matching loaded documents",async()=>{render(view());await screen.findByRole("button",{name:/study.md/u});fireEvent.change(screen.getByLabelText("知识领域"),{target:{value:"mathematics"}});expect(screen.queryByRole("button",{name:/study.md/u})).toBeNull();});
 it("switches English immediately without fetching again",async()=>{await load();const count=fetchMock.mock.calls.length;fireEvent.change(screen.getByLabelText("界面语言"),{target:{value:"en"}});expect(await screen.findByRole("button",{name:"Chapter test"})).toBeTruthy();expect(screen.getByText("Learning records stay in this page session only. Refreshing or leaving clears them; they are not permanently saved.")).toBeTruthy();expect(fetchMock).toHaveBeenCalledTimes(count);});
 it("clears session and stores no private study material",async()=>{await load();fireEvent.click(screen.getByRole("button",{name:"标记已学习"}));expect(screen.getByRole("button",{name:"已学习"})).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"清空训练会话"}));expect(screen.queryByRole("button",{name:"已学习"})).toBeNull();expect(JSON.stringify(localStorage)).not.toContain(doc.file_name);});
 it("generation failure is recoverable without raw error",async()=>{render(view());await screen.findByRole("button",{name:/study.md/u});fetchMock.mockRejectedValueOnce(Error("SECRET"));fireEvent.click(screen.getByRole("button",{name:/study.md/u}));expect(await screen.findByRole("alert")).toHaveProperty("textContent","训练生成失败，请检查文档状态后重试。");expect(document.body.textContent).not.toContain("SECRET");expect((screen.getByRole("button",{name:/study.md/u}) as HTMLButtonElement).disabled).toBe(false);});
 it("duplicate generation clicks produce one request",async()=>{render(view());const b=await screen.findByRole("button",{name:/study.md/u});let done:(r:Response)=>void=()=>{};fetchMock.mockImplementationOnce(()=>new Promise<Response>(r=>{done=r;}));fireEvent.click(b);fireEvent.click(b);expect(fetchMock).toHaveBeenCalledTimes(2);done(Response.json({pack:pack()}));await screen.findByText("规则生成；题目与答案关联原文，不代表模型训练或微调。");});
 it("rejects another user's pack",async()=>{render(view());await screen.findByRole("button",{name:/study.md/u});fetchMock.mockResolvedValueOnce(Response.json({pack:{...pack(),ownerId:"other"}}));fireEvent.click(screen.getByRole("button",{name:/study.md/u}));expect(await screen.findByRole("alert")).toBeTruthy();expect(screen.queryByText("查看原文与来源")).toBeNull();});
 it("uses wrapping controls and no fixed minimum-width table",async()=>{await load();const section=screen.getByRole("region",{name:"知识训练工作区"});expect(section.className).toContain("min-w-0");expect(section.querySelector("table")).toBeNull();expect(section.querySelectorAll(".flex-wrap").length).toBeGreaterThan(0);expect(section.querySelectorAll(".min-h-11").length).toBeGreaterThan(6);});
 it("StrictMode effect cleanup does not lose the catalog",async()=>{render(<StrictMode>{view()}</StrictMode>);expect(await screen.findByRole("button",{name:/study.md/u})).toBeTruthy();});
});

it("sign-out clears every source and learning result immediately",async()=>{
 let notify: (event:string,session:{user:{id:string}}|null)=>void=()=>{};
 vi.mocked(createClient).mockReturnValue({auth:{onAuthStateChange:(cb:typeof notify)=>{notify=cb;return {data:{subscription:{unsubscribe:vi.fn()}}};}}} as never);
 await load();act(()=>notify("SIGNED_OUT",null));expect(screen.queryByText("查看原文与来源")).toBeNull();expect(screen.getByRole("alert").textContent).toBe("登录身份已改变，请重新进入训练页面。");expect(screen.queryByRole("button",{name:/study.md/u})).toBeNull();
});
it("clearing during generation rejects a late successful result",async()=>{
 await load();let resolve: (r:Response)=>void=()=>{};fetchMock.mockImplementationOnce(()=>new Promise<Response>(r=>{resolve=r;}));fireEvent.click(screen.getByRole("button",{name:/study.md/u}));fireEvent.click(screen.getByRole("button",{name:"清空训练会话"}));resolve(Response.json({pack:pack()}));await waitFor(()=>expect(screen.queryByText("正在生成带来源的训练内容…")).toBeNull());expect(screen.queryByText("查看原文与来源")).toBeNull();
});
