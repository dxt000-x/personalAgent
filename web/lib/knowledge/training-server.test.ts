import { describe,it,expect,vi } from "vitest";
import { SupabaseTrainingRepository } from "./training-server";
import { trainingOwner as owner,trainingDoc as doc } from "./training-fixtures";
function client(data:unknown[]){const q={eq:vi.fn(),order:vi.fn(),limit:vi.fn()};q.eq.mockReturnValue(q);q.order.mockReturnValue(q);q.limit.mockResolvedValue({data,error:null});return {client:{from:vi.fn(()=>({select:vi.fn(()=>q)}))},q};}
describe("training source repository ownership/sequence checks",()=>{
 it("uses exact document and owner predicates",async()=>{const {client:c,q}=client([{document_id:doc.id,user_id:owner,chunk_index:0,content:"source"}]);expect(await new SupabaseTrainingRepository(c as never).chunks(owner,doc.id)).toEqual(["source"]);expect(q.eq.mock.calls).toEqual([["document_id",doc.id],["user_id",owner]]);expect(q.limit).toHaveBeenCalledWith(200);});
 it.each([{document_id:doc.id,user_id:"other",chunk_index:0,content:"private"},{document_id:"other",user_id:owner,chunk_index:0,content:"private"},{document_id:doc.id,user_id:owner,chunk_index:1,content:"gap"}])("fails closed for mismatched source",async row=>{const {client:c}=client([row]);await expect(new SupabaseTrainingRepository(c as never).chunks(owner,doc.id)).rejects.toMatchObject({code:"KNOWLEDGE_UNAVAILABLE"});});
});
