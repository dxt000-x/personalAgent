// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {KnowledgeWorkspace} from "./knowledge-workspace";
vi.mock("@/lib/supabase/client",()=>({createClient:()=>null}));
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it("keeps document content visible but disables mutations while refreshing",async()=>{
 const document={id:"11111111-1111-4111-8111-111111111111",file_name:"已加载的文档.txt",file_type:"txt",status:"ready",chunk_count:1,updated_at:"2026-11-08T00:00:00Z"};
 let resolve!: (response:Response)=>void;
 const response=()=>({ok:true,json:async()=>({documents:[document]})}) as Response;
 let documentLoads=0;
 const fetch=vi.fn((url:string)=>{
   if(url==="/api/knowledge/classifications") return Promise.resolve({ok:true,json:async()=>({classifications:[]})} as Response);
   if(documentLoads++===0) return Promise.resolve(response());
   return new Promise<Response>(done=>{resolve=done});
 });
 vi.stubGlobal("fetch",fetch);render(<KnowledgeWorkspace/>);
 await screen.findByRole("cell",{name:document.file_name});
 fireEvent.click(screen.getByRole("button",{name:"刷新状态"}));
 expect(screen.getByRole("cell",{name:document.file_name})).toBeTruthy();
 expect(screen.getByText("正在刷新，暂时显示上次结果…")).toBeTruthy();
 expect(screen.getByRole("button",{name:"删除"})).toHaveProperty("disabled",true);
 resolve(response());
 await screen.findByRole("button",{name:"刷新状态"});
});
