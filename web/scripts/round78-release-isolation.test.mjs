// @vitest-environment node
// Static virtual composition only. No checkout, index, env or remote operations.
import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { auditRelease } from "./round78-release-audit.mjs";
const root=new URL("../../",import.meta.url),read=p=>readFileSync(new URL(p,root),"utf8");
function queryMap(source){const ast=ts.createSourceFile("source.ts",source,ts.ScriptTarget.Latest,true);const entries={};const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==="sql"&&n.initializer&&ts.isObjectLiteralExpression(n.initializer)){for(const p of n.initializer.properties){if(ts.isPropertyAssignment(p)&&ts.isStringLiteral(p.initializer))entries[p.name.getText(ast)]=p.initializer.text;}}ts.forEachChild(n,visit);};visit(ast);return entries;}
describe("round78 source isolation and release tree",()=>{
 it("exact historical baseline + original allowlist has complete types and no forbidden live imports",()=>{
  const archive=JSON.parse(read("docs/testing/round78-historical-source-snapshot-20261115.json"));
  const manifest=Buffer.from(archive.manifestBase64,"base64");
  expect(createHash("sha256").update(manifest).digest("hex")).toBe("7cca9e5d1649ea6679f518efc221632103fdeaae4558d02c9e4dd3e4adb9ebc6");
  expect(archive.manifestSha256).toBe("7cca9e5d1649ea6679f518efc221632103fdeaae4558d02c9e4dd3e4adb9ebc6");
  const manifestData=JSON.parse(manifest.toString("utf8"));
  expect(JSON.parse(read("docs/testing/round78-frontend-release-allowlist-20261115.json"))).toEqual(manifestData);
  const sourceSnapshot=JSON.parse(gunzipSync(Buffer.from(archive.data,"base64"),{maxOutputLength:4*1024*1024}).toString("utf8"));
  expect(Object.keys(sourceSnapshot)).toHaveLength(62);
  expect(archive.fileCount).toBe(62);
  expect(auditRelease({sourceSnapshot,manifestData})).toMatchObject({status:"STATIC_PASS",issues:[],typeDiagnostics:[]});
  const corrupted={...sourceSnapshot,[Object.keys(sourceSnapshot)[0]]:"changed"};
  expect(auditRelease({sourceSnapshot:corrupted,manifestData})).toMatchObject({status:"BLOCKED",issues:expect.arrayContaining([expect.objectContaining({code:"SOURCE_HASH_MISMATCH"})])});
 },30000);
 it("i18n core/provider is independent of database and Writer",()=>{for(const p of ["web/lib/i18n/core.ts","web/components/i18n-provider.tsx"])expect(read(p)).not.toMatch(/from ["'].*(?:supabase|knowledge|private-db)|fetch\(/u);});
 it("both classification routes import only the closed response policy",()=>{for(const p of ["web/app/api/knowledge/classifications/route.ts","web/app/api/knowledge/[id]/classification/route.ts"]){const s=read(p);expect(s).toContain("return classificationPersistenceUnavailable()");expect(s).not.toMatch(/requireKnowledge|SupabaseClassification|classifyAndSave|editClassification|readSmallJson/u);}});
 it("Knowledge UI does not request classification fields or endpoints",()=>{const s=read("web/components/knowledge-workspace.tsx");expect(s).not.toContain("KnowledgeClassificationManager");expect(s).not.toContain("/classifications");expect(s).not.toContain("/classification`");expect(s).toContain('href="/training"');});
 it("read-only training does not import Writer facade",()=>{expect(read("web/lib/knowledge/training-server.ts")).toContain('from "./read-server"');expect(read("web/app/api/knowledge/training/route.ts")).toContain('from "@/lib/knowledge/read-server"');const s=read("web/lib/knowledge/read-server.ts");expect(s).not.toMatch(/from ["'].*(?:private-db|classification-server)|\.rpc\(|\.insert\(|\.update\(/u);expect(s).not.toContain("knowledge_classification");});
 it("all established Writer SQL operations are byte-identical to production baseline",()=>{const original=execFileSync("git",["show","9d27edb1a2a40665fde89146295086aa1ca853da:web/lib/knowledge/private-db.ts"],{cwd:root,encoding:"utf8"});const current=read("web/lib/knowledge/private-db.ts");expect(queryMap(current)).toEqual(queryMap(original));expect(Object.keys(queryMap(current))).toHaveLength(6);expect(current).not.toContain("knowledge_private.save_knowledge_classification(");});
 it("established read columns are unchanged",()=>{const original=execFileSync("git",["show","9d27edb1a2a40665fde89146295086aa1ca853da:web/lib/knowledge/server.ts"],{cwd:root,encoding:"utf8"});const pattern=/(?:export )?const documentColumns = "([^"]+)"/u;expect(pattern.exec(read("web/lib/knowledge/read-server.ts"))[1]).toBe(pattern.exec(original)[1]);});
});
