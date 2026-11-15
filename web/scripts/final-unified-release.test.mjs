// Offline source gates: no credentials, database or live model calls.
import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { auditRelease } from "./round78-release-audit.mjs";
const root=new URL("../../",import.meta.url);
const read=p=>readFileSync(new URL(p,root),"utf8");
const base="1cb9c687f9cf6ed761cbd191d0fe034ee33d61fc";
describe("unified delivery source gates",()=>{
 it("audits the new independent candidate with its own manifest",()=>{
  expect(auditRelease({manifestPath:"docs/testing/final-unified-release-allowlist-20261115.json",expectedBaseCommit:base})).toMatchObject({status:"STATIC_PASS",issues:[],typeDiagnostics:[]});
 },30000);
 it("refuses to pass changed current sources as the historical release",()=>{
  expect(auditRelease()).toMatchObject({status:"BLOCKED",issues:expect.arrayContaining([expect.objectContaining({code:"SOURCE_HASH_MISMATCH"})])});
 });
 it.each(["web/lib/ai/gateway.ts","web/lib/ai/quota.ts","web/lib/ai/__tests__/quota.test.ts"])("preserves verified Agent Git blob: %s",p=>{
  const original=execFileSync("git",["rev-parse",base+":"+p],{cwd:root,encoding:"utf8"}).trim();
  expect(execFileSync("git",["hash-object","--path="+p,p],{cwd:root,encoding:"utf8"}).trim()).toBe(original);
 });
 it("keeps the original 404 regression assertions and fixes only its local-availability fixture",()=>{
  const p="web/lib/ai/__tests__/gateway-timeout.test.ts";
  const original=execFileSync("git",["show",base+":"+p],{cwd:root,encoding:"utf8"});
  const anchor='it("falls back from an upstream 404 in Auto mode and reserves cloud quota once", async () => {';
  expect(read(p).replaceAll("\r\n","\n")).toBe(original.replace(anchor,anchor+'\n    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));'));
 });
 it("keeps signing and strict plan validation rather than bypassing successful execution",()=>{
  const plan=read("web/app/api/agent/plan/route.ts");
  expect(plan.indexOf("hasExecutionSigningKey()" )).toBeLessThan(plan.indexOf("await runAiGateway"));
  expect(plan).toContain('new AIGatewayError("PLAN_INVALID_OUTPUT")');
  for(const p of ["web/lib/agent/planning.ts","web/lib/agent/execution-authorization.ts","web/app/api/agent/confirm/route.ts","web/app/api/agent/execute/route.ts"]){
   expect(execFileSync("git",["hash-object","--path="+p,p],{cwd:root,encoding:"utf8"}).trim()).toBe(execFileSync("git",["rev-parse",base+":"+p],{cwd:root,encoding:"utf8"}).trim());
  }
 });
});
