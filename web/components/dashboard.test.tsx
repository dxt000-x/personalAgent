// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import Dashboard from "../app/(workspace)/page";
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
afterEach(cleanup);
it("offers real workspace entries and keeps example task recovery non-interactive",()=>{
 render(<Dashboard/>);
 expect(screen.getByRole("link",{name:"进入 Agent 工作区 →"}).getAttribute("href")).toBe("/agent");
 expect(screen.queryByRole("link",{name:/继续上次任务/})).toBeNull();
 const preview=screen.getByText("产品预览 · 任务与项目看板（演示数据）");
 fireEvent.click(preview);
 expect(screen.getByText(/任务历史与恢复功能尚未实现/)).toBeTruthy();
 expect(screen.getByText("示例进度 35% · 非实际完成度")).toBeTruthy();
});
