// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {AppSidebar} from "./app-sidebar";
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock("next/navigation",()=>({usePathname:()=>"/knowledge",useRouter:()=>({push:vi.fn()})}));
vi.mock("./account-menu",()=>({AccountMenu:({email}:{email:string})=><p>{email}</p>}));
afterEach(cleanup);
describe("responsive workspace navigation",()=>{
  it("starts collapsed, labels the current page, and supports Escape with focus return",()=>{
    render(<AppSidebar userEmail="fixture@example.invalid"/>);
    const toggle=screen.getByRole("button",{name:"展开导航"});
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const menu=document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(menu.classList.contains("hidden")).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const current=screen.getByRole("link",{name:/知识库/});
    expect(current.getAttribute("aria-current")).toBe("page");
    current.focus();fireEvent.keyDown(current,{key:"Escape"});
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });
  it("closes the mobile menu when a navigation link is selected",()=>{
    render(<AppSidebar userEmail="fixture@example.invalid"/>);
    const toggle=screen.getByRole("button",{name:"展开导航"});fireEvent.click(toggle);
    const link=screen.getByRole("link",{name:/知识库/});
    link.addEventListener("click",(event)=>event.preventDefault());fireEvent.click(link);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
