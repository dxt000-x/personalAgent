// Offline virtual release-tree audit: never stages, commits, contacts GitHub or loads env.
import { readFileSync,existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve,dirname,relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root=fileURLToPath(new URL("../../",import.meta.url)),web=resolve(root,"web");
export function auditRelease({manifestPath="docs/testing/round78-frontend-release-allowlist-20261115.json",expectedBaseCommit="9d27edb1a2a40665fde89146295086aa1ca853da",sourceSnapshot,manifestData}={}){
 const manifest=manifestData??JSON.parse(readFileSync(resolve(root,manifestPath),"utf8"));
 if(manifest.baseCommit!==expectedBaseCommit)return {status:"BLOCKED",issues:[{code:"BASE_COMMIT_NOT_APPROVED"}],typeDiagnostics:[]};
 const source=p=>sourceSnapshot===undefined?readFileSync(resolve(root,p)):typeof sourceSnapshot[p]==="string"?Buffer.from(sourceSnapshot[p],"utf8"):undefined;
 const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8",maxBuffer:16777216});
 const baseline=new Set(git("ls-tree","-r","--name-only",manifest.baseCommit).trim().split("\n"));
 const allow=new Map(manifest.files.map(f=>[f.path,f])),issues=[];
 if(allow.size!==manifest.files.length)issues.push({code:"DUPLICATE_ALLOWLIST"});
 for(const f of manifest.files){
  if(typeof f.path!=="string"||!f.path.startsWith("web/")||f.path.includes("..")||f.path.includes("/node_modules/")||/(?:^|\/)\.env|\.sql$/u.test(f.path)||!["runtime","test"].includes(f.kind)||typeof f.sha256!=="string"||!/^[a-f0-9]{64}$/u.test(f.sha256)){issues.push({code:"FORBIDDEN_ALLOWLIST_PATH"});continue;}
  const bytes=sourceSnapshot===undefined&&!existsSync(resolve(root,f.path))?undefined:source(f.path);
  if(bytes===undefined||createHash("sha256").update(bytes).digest("hex")!==f.sha256)issues.push({code:"SOURCE_HASH_MISMATCH",file:f.path});}
 for(const f of manifest.excludedWorkingTreeFiles)if(allow.has(f))issues.push({code:"EXCLUDED_FILE_ALLOWED",file:f});
 if(issues.length)return {status:"BLOCKED",allowlistFiles:allow.size,issues,typeDiagnostics:[]};
 const cache=new Map(),norm=p=>relative(root,resolve(p)).replaceAll("\\","/");
 const read=p=>{const key=norm(p);if(key.startsWith("../")||key.includes("/node_modules/")||key.startsWith("web/.next/"))return ts.sys.readFile(p);if(cache.has(key))return cache.get(key);let value;if(allow.has(key))value=source(key)?.toString("utf8");else if(baseline.has(key))value=git("show",manifest.baseCommit+":"+key);cache.set(key,value);return value;};
 const fileExists=p=>{const key=norm(p);return key.startsWith("../")||key.includes("/node_modules/")||key.startsWith("web/.next/")?ts.sys.fileExists(p):allow.has(key)||baseline.has(key);};
 const config=ts.readConfigFile(resolve(web,"tsconfig.json"),read);const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,web,{noEmit:true,incremental:false});
 const roots=parsed.fileNames.filter(p=>fileExists(p)&&!norm(p).startsWith("web/.next/"));
 const host=ts.createCompilerHost(parsed.options);host.readFile=read;host.fileExists=fileExists;host.getSourceFile=(name,language)=>{const source=read(name);return source===undefined?undefined:ts.createSourceFile(name,source,language,true);};
 const program=ts.createProgram(roots,parsed.options,host);
 const diagnostics=ts.getPreEmitDiagnostics(program).map(d=>({code:d.code,file:d.file?norm(d.file.fileName):null,line:d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start).line+1:null}));
 const runtime=new Set([...baseline,...allow.keys()].filter(p=>/web\/app\/.*(?:page|layout|route)\.tsx?$/u.test(p)));
 const edges=new Map();
 for(const source of program.getSourceFiles()){
  const key=norm(source.fileName);if(key.includes("/node_modules/")||!key.startsWith("web/"))continue;
  const specs=[];const visit=n=>{if(ts.isImportDeclaration(n)&&!n.importClause?.isTypeOnly&&ts.isStringLiteral(n.moduleSpecifier))specs.push(n.moduleSpecifier.text);if(ts.isExportDeclaration(n)&&!n.isTypeOnly&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))specs.push(n.moduleSpecifier.text);if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&n.arguments.length===1&&ts.isStringLiteral(n.arguments[0]))specs.push(n.arguments[0].text);ts.forEachChild(n,visit);};visit(source);
  edges.set(key,specs.flatMap(spec=>{if(!spec.startsWith(".")&&!spec.startsWith("@/"))return [];const target=spec.startsWith("@/")?resolve(web,spec.slice(2)):resolve(dirname(source.fileName),spec);const resolved=[target,...[".ts",".tsx",".mjs",".js",".json","/index.ts","/index.tsx"].map(e=>target+e)].find(fileExists);return resolved?[norm(resolved)]:[];}));
 }
 const reachable=new Set();const walk=k=>{if(reachable.has(k))return;reachable.add(k);for(const dep of edges.get(k)??[])walk(dep);};for(const k of runtime)walk(k);
 const forbidden=["web/lib/knowledge/classification-server.ts","web/lib/knowledge/classification-service.ts","web/lib/knowledge/classification-http.ts","web/lib/knowledge/classification-disabled-handlers.ts","web/components/knowledge-classification-manager.tsx"];
 for(const k of forbidden)if(reachable.has(k))issues.push({code:"FORBIDDEN_RUNTIME_REACHABLE",file:k});
 const training=new Set();const walkTraining=k=>{if(training.has(k))return;training.add(k);for(const dep of edges.get(k)??[])walkTraining(dep);};walkTraining("web/app/api/knowledge/training/route.ts");
 for(const k of ["web/lib/knowledge/server.ts","web/lib/knowledge/private-db.ts",...forbidden])if(training.has(k))issues.push({code:"TRAINING_WRITER_COUPLING",file:k});
 const policy=read(resolve(web,"lib/knowledge/classification-release-policy.ts"));if(!policy.includes("KNOWLEDGE_CLASSIFICATION_PERSISTENCE_ENABLED: boolean = false"))issues.push({code:"CLASSIFICATION_POLICY_NOT_CLOSED"});
 return {status:issues.length||diagnostics.length?"BLOCKED":"STATIC_PASS",baseCommit:manifest.baseCommit,allowlistFiles:allow.size,virtualSourceFiles:roots.length,runtimeEntries:runtime.size,issues,typeDiagnostics:diagnostics};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=auditRelease();console.log(JSON.stringify(r));process.exitCode=r.status==="STATIC_PASS"?0:2;}
