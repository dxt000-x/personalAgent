// Read-only static coverage; never loads env, browser preferences or databases.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function auditI18n(root = fileURLToPath(new URL("../", import.meta.url)), injectedCatalog) {
  const catalogPath = resolve(root, "lib/i18n/messages.ts");
  const compiled = ts.transpileModule(readFileSync(catalogPath, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { english, chineseOverrides } = injectedCatalog ?? await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const files = readdirSync(resolve(root, "components")).filter((p) => p.endsWith(".tsx") && !p.includes(".test.")).map((p) => `components/${p}`);
  for (const page of ["app/(workspace)/page.tsx", "app/(workspace)/layout.tsx", "app/(workspace)/memory/page.tsx", "app/(workspace)/knowledge/page.tsx", "app/(workspace)/settings/page.tsx", "app/(workspace)/training/page.tsx",
    "lib/knowledge/errors.ts", "lib/memories/errors.ts", "lib/ai/errors.ts", "lib/supabase/config.ts", "lib/knowledge/classification-types.ts"]) files.push(page);
  const required = new Map(), rawUi = [];
  const brands = new Set(["Personal AI", "Personal AI Assistant", "Assistant", "中文", "English"]);
  const exempt = new Set(["…[历史回复已截断]"]);
  const requireKey = (s, p) => { if (s && !brands.has(s) && !exempt.has(s)) required.set(s, p); };
  for (const path of files) {
    const sf = ts.createSourceFile(path, readFileSync(resolve(root, path), "utf8"), ts.ScriptTarget.Latest, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const walk = (n) => {
      if (ts.isJsxText(n)) { const s = n.text.replace(/\s+/gu, " ").trim(); if (/[\p{L}]/u.test(s) && !brands.has(s)) rawUi.push({ path, message: s }); }
      if (ts.isStringLiteral(n)) {
        if (ts.isJsxAttribute(n.parent) && ["aria-label", "aria-description", "placeholder", "alt"].includes(n.parent.name.getText(sf))
          && /[\u3400-\u9fff]/u.test(n.text)) rawUi.push({ path, message: n.text });
        if (/[\u3400-\u9fff]/u.test(n.text)) requireKey(n.text, path);
        if (ts.isCallExpression(n.parent) && ts.isIdentifier(n.parent.expression) && n.parent.expression.text === "t" && n.parent.arguments[0] === n) requireKey(n.text, path);
        if (ts.isJsxAttribute(n.parent) && ["eyebrow", "title", "subtitle", "description", "source"].includes(n.parent.name.getText(sf))) requireKey(n.text, path);
        if (ts.isPropertyAssignment(n.parent) && n.parent.name.getText(sf) === "label") requireKey(n.text, path);
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
  }
  const missing = [...required].filter(([key]) => !Object.hasOwn(english, key)).map(([message, path]) => ({ path, message }));
  const invalid = Object.entries(english).filter(([key, value]) => !key.trim() || typeof value !== "string" || !value.trim()).map(([key]) => key);
  const orphanOverrides = Object.keys(chineseOverrides).filter((key) => !Object.hasOwn(english, key));
  const placeholderMismatch = Object.entries(english).filter(([key, value]) => {
    const tokens = (v) => (v.match(/\{(?:\d+|[a-zA-Z_]+)\}/gu) ?? []).sort().join(",");
    return tokens(key) !== tokens(value) || tokens(key) !== tokens(chineseOverrides[key] ?? key);
  }).map(([key]) => key);
  return { files: files.length, keys: Object.keys(english).length, required: required.size, missing, rawUi, invalid, orphanOverrides, placeholderMismatch,
    status: missing.length || rawUi.length || invalid.length || orphanOverrides.length || placeholderMismatch.length ? "FAIL" : "PASS" };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await auditI18n(); console.log(JSON.stringify(result, null, 2)); if (result.status !== "PASS") process.exitCode = 1;
}
