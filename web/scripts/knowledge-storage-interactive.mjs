// Isolated-project Storage acceptance only. This module never reads .env.local
// and never accepts credentials through argv or process.env.
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename, normalize } from "node:path";
import { TextDecoder } from "node:util";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

export const PROJECT_NAME = "personal-agent-quota-test";
export const PROJECT_REF = "pxfaqcepztzqyqtmbdrf";
export const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
export const TEST_WEB_DIRECTORY = "D:\\龙虾\\Codex\\PersonalAgent-KB-Test\\web";
const BUCKET = "knowledge-files";
const PREFIX = "kb-isolation-test-";
const CONFIRM_FILES = "CONFIRM TEST FILES";

class CheckFailure extends Error {
  constructor(message, source) {
    super(message);
    // Keep only public protocol fields, never the raw server error or message.
    this.status = Number.isInteger(source?.status) ? source.status : undefined;
    this.code = source?.code;
  }
}
class TerminalInputFailure extends CheckFailure {}
const authCodes = new Set(["invalid_credentials", "invalid_api_key", "invalid_jwt", "bad_jwt",
  "email_not_confirmed", "user_banned", "over_request_rate_limit", "unexpected_failure"]);
const networkCodes = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]);
const fileCodes = new Set(["ENOENT", "EACCES", "EPERM", "EISDIR"]);
const databaseCodes = new Set(["28P01", "28000", "42501", "08001", "08006", "3F000", "57P01"]);
const storageCodes = new Set(["AccessDenied", "NoSuchKey", "InvalidJWT", "not_found", "PGRST116"]);
class AuthFailure extends CheckFailure {
  constructor(account, phase, error) {
    super("测试账号认证失败");
    this.account = account;
    this.phase = phase;
    this.status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
      ? error.status : null;
    this.authCode = authCodes.has(error?.code) ? error.code : null;
    this.networkCode = networkCodes.has(error?.cause?.code) ? error.cause.code :
      networkCodes.has(error?.code) ? error.code : null;
    this.kind = this.authCode === "invalid_credentials" ? "账号或密码错误" :
      ["invalid_api_key", "invalid_jwt", "bad_jwt"].includes(this.authCode) ||
      (this.status === 401 && error?.message === "Invalid API key") ? "API Key 错误" :
      this.networkCode || error?.name === "AuthRetryableFetchError" ? "网络失败" :
      "认证失败，原因待核实";
  }
}
const requireTrue = (condition, message, source) => { if (!condition) throw new CheckFailure(message, source); };

export function assertTestWorktree(cwd, resolve = realpathSync.native) {
  const actual = normalize(resolve(cwd)).toLowerCase();
  const expected = normalize(resolve(TEST_WEB_DIRECTORY)).toLowerCase();
  requireTrue(actual === expected, "只能在指定的 PersonalAgent-KB-Test/web 中运行");
}

export function validatePublishableKey(value) {
  const key = value.trim();
  if (key.startsWith("sb_publishable_") && key.length > "sb_publishable_".length) return key;
  try {
    const parts = key.split(".");
    requireTrue(parts.length === 3, "仅接受测试项目 publishable/anon key");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    requireTrue(payload.role === "anon" && payload.ref === PROJECT_REF,
      "仅接受测试项目 publishable/anon key");
    return key;
  } catch { throw new CheckFailure("仅接受测试项目 publishable/anon key"); }
}

export function validateWriterConnection(raw, ca) {
  let url;
  try { url = new URL(raw.trim()); }
  catch { throw new CheckFailure("受限连接格式无效"); }
  requireTrue(url.protocol === "postgresql:" && url.port === "6543" &&
    url.pathname === "/postgres" && !url.search && !url.hash && Boolean(url.password),
  "受限连接必须使用带密码的 Supabase Transaction Pooler :6543/postgres");
  requireTrue(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/u.test(url.hostname),
    "数据库主机必须是 Supabase Transaction Pooler");
  requireTrue(decodeURIComponent(url.username) === `knowledge_writer_login.${PROJECT_REF}`,
    "受限连接角色或 Project Ref 不匹配");
  validateCaPem(ca);
  return {
    host: url.hostname, port: 6543, database: "postgres",
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    connectionTimeoutMillis: 5000, query_timeout: 15000,
    ssl: { ca, servername: url.hostname, rejectUnauthorized: true },
  };
}

export function validateCaPem(ca) {
  requireTrue(typeof ca === "string" && ca.length <= 65536, "TLS CA PEM 内容无效");
  const normalized = ca.trim().replaceAll("\r\n", "\n");
  const blocks = normalized.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu);
  requireTrue(blocks?.length > 0 && normalized.replaceAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu, "").trim() === "",
    "TLS CA PEM 内容无效");
  try { for (const block of blocks) new X509Certificate(block); }
  catch { throw new CheckFailure("TLS CA PEM 内容无效"); }
  return normalized;
}

function failureCategory(stage, error) {
  if (error instanceof TerminalInputFailure) return "终端读取失败";
  if (stage.includes("CA 文件") || stage.includes("CA PEM")) return "CA 文件或证书错误";
  if (stage.includes("数据库连接")) return "数据库连接或 TLS 错误";
  if (stage.includes("数据库权限")) return "数据库权限错误";
  if (stage.includes("夹具") || stage.includes("一次性")) return "测试夹具错误";
  if (stage.includes("Storage") || stage.includes("下载") || stage.includes("删除") || stage.includes("上传"))
    return "Storage 请求或校验失败";
  if (error instanceof CheckFailure) return "前置校验失败";
  return "请求失败";
}

function safeErrorCode(error) {
  const candidates = [error?.code, error?.cause?.code];
  return candidates.find((code) => fileCodes.has(code) || networkCodes.has(code) ||
    databaseCodes.has(code) || storageCodes.has(code)) ?? "无";
}

function safeHttpStatus(error) {
  return Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
    ? error.status : "无";
}

function bucket(client) { return client.storage.from(BUCKET); }
function denied(error) {
  const status = Number(error?.status);
  return Boolean(error) && [400, 401, 403, 404].includes(status);
}
async function snapshot(client, document) {
  const response = await bucket(client).download(document.storage_path);
  requireTrue(!response.error && response.data, "本人无法下载测试原件", response.error);
  const bytes = Buffer.from(await response.data.arrayBuffer());
  requireTrue(bytes.length === document.byte_size && bytes.length > 0, "测试原件大小不符");
  return { length: bytes.length, hash: createHash("sha256").update(bytes).digest("hex") };
}
async function checkUnchanged(client, document, before) {
  const after = await snapshot(client, document);
  requireTrue(after.length === before.length && after.hash === before.hash,
    "越权操作后测试原件不存在或内容已变化");
}
function fixtureDocument(data, userId) {
  requireTrue(Array.isArray(data), "无法列出当前账号文档");
  const matches = data.filter((row) => row.file_name?.startsWith(PREFIX) && row.status === "ready");
  requireTrue(matches.length === 1, "每个账号须恰好有一份 ready 的 kb-isolation-test- 测试文件");
  const doc = matches[0];
  requireTrue(/^kb-isolation-test-[A-Za-z0-9_.-]+\.(pdf|txt|md)$/u.test(doc.file_name) &&
    doc.user_id === userId &&
    doc.storage_path === `${userId}/${doc.id}/source.${doc.file_type}` &&
    Number.isSafeInteger(doc.byte_size) && doc.byte_size > 0 && doc.byte_size <= 4194304,
  "测试文档路径或大小无效");
  return doc;
}

export async function runInteractiveStorage({
  prompt, report = console.log, cwd = process.cwd(), resolvePath = realpathSync.native,
  createSupabase = createClient, createWriter = (config) => new pg.Client(config),
  readCertificate = readFile,
}) {
  let writer;
  let ownerB;
  let userBId;
  let temporary;
  let insertedConfirmed = false;
  let passed = false;
  let cleanupFailed = false;
  let stage = "前置检查";
  const step = async (label, action) => {
    stage = label;
    const result = await action();
    report(`${label}: PASS`);
    return result;
  };
  try {
    stage = "项目身份与运行目录";
    assertTestWorktree(cwd, resolvePath);
    report(`目标项目：${PROJECT_NAME} (${PROJECT_URL})`);
    requireTrue(await prompt.ask("请在 Supabase 控制台核对项目名称后输入完整名称：") === PROJECT_NAME,
      "项目名称未获人工确认");
    report("项目身份与运行目录: PASS");

    stage = "测试项目 Publishable Key 输入与校验";
    const key = validatePublishableKey(await prompt.ask("测试项目 publishable key：", true));
    const clientA = createSupabase(PROJECT_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const clientB = createSupabase(PROJECT_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const login = async (client, label) => {
      stage = `${label} 账号终端输入`;
      const email = (await prompt.ask(`${label} 测试账号邮箱：`, true)).trim();
      const password = await prompt.ask(`${label} 测试账号密码：`, true);
      requireTrue(email.length > 0 && password.length > 0, "账号或密码输入为空");
      stage = `${label} 账号登录`;
      let signed;
      try { signed = await client.auth.signInWithPassword({ email, password }); }
      catch (error) { throw new AuthFailure(label, "signInWithPassword", error); }
      if (signed.error) throw new AuthFailure(label, "signInWithPassword", signed.error);
      stage = `${label} 账号身份验证`;
      let verified;
      try { verified = await client.auth.getUser(); }
      catch (error) { throw new AuthFailure(label, "getUser", error); }
      if (verified.error) throw new AuthFailure(label, "getUser", verified.error);
      requireTrue(verified.data?.user?.id, "测试账号身份验证未返回用户 ID");
      return verified.data.user.id;
    };
    const userAId = await login(clientA, "A");
    userBId = await login(clientB, "B");
    requireTrue(userAId !== userBId, "A/B 必须是不同账号");
    ownerB = clientB;
    report("A/B 短期会话与不同身份: PASS");

    const columns = "id,user_id,file_name,file_type,byte_size,storage_path,status";
    const ownDocs = async (client, userId) => {
      const result = await client.from("knowledge_documents").select(columns);
      requireTrue(!result.error, "无法读取当前账号文档", result.error);
      return fixtureDocument(result.data, userId);
    };
    const aDoc = await step("A 测试夹具初始化", () => ownDocs(clientA, userAId));
    const bDoc = await step("B 测试夹具初始化", () => ownDocs(clientB, userBId));
    report(`A 可丢弃文件：${JSON.stringify(aDoc.file_name)}`);
    report(`B 可丢弃文件：${JSON.stringify(bDoc.file_name)}`);
    stage = "测试夹具人工确认";
    requireTrue(await prompt.ask(`确认这两份文件可丢弃，输入 ${CONFIRM_FILES}：`) === CONFIRM_FILES,
      "未确认可丢弃文件");
    const aBefore = await step("A 本人下载与大小校验", () => snapshot(clientA, aDoc));
    const bBefore = await step("B 本人下载与大小校验", () => snapshot(clientB, bDoc));

    stage = "Pooler URL 终端输入";
    const writerUrl = await prompt.ask("测试项目 knowledge_writer_login Pooler URL：", true);
    stage = "TLS CA 文件路径输入";
    const caPath = await prompt.ask("测试项目 TLS CA PEM 文件路径：");
    const caFile = await step("TLS CA 文件路径校验", async () => {
      requireTrue(basename(caPath).toLowerCase() !== ".env.local" && /\.(pem|crt)$/iu.test(caPath),
        "TLS CA 必须来自独立 PEM/CRT 文件，不能读取 .env.local");
      const resolvedCa = normalize(resolvePath(caPath));
      const canonicalCa = resolvedCa.toLowerCase();
      requireTrue((canonicalCa.startsWith(normalize("D:\\codex\\").toLowerCase()) ||
        canonicalCa.startsWith(normalize(`${TEST_WEB_DIRECTORY}\\`).toLowerCase())) &&
        basename(canonicalCa) !== ".env.local",
      "TLS CA 文件必须位于 D:\\codex 或独立测试 Worktree，不能读取开发目录配置");
      return resolvedCa;
    });
    const caText = await step("TLS CA 文件加载", () => readCertificate(caFile, "utf8"));
    const ca = await step("TLS CA PEM 解析", async () => validateCaPem(caText));
    const writerConfig = await step("受限数据库连接配置校验", async () => validateWriterConnection(writerUrl, ca));
    await step("受限数据库连接与 TLS", async () => {
      writer = createWriter(writerConfig);
      await writer.connect();
    });
    await step("受限数据库权限验证", async () => {
      const result = await writer.query(
        "select has_function_privilege(current_user, 'knowledge_private.mark_knowledge_deleting(uuid,uuid)', 'EXECUTE') as mark_allowed, has_function_privilege(current_user, 'knowledge_private.finish_knowledge_deletion(uuid,uuid)', 'EXECUTE') as finish_allowed",
      );
      requireTrue(result.rows[0]?.mark_allowed === true && result.rows[0]?.finish_allowed === true,
        "受限数据库角色缺少清理例程权限");
    });

    await step("A 无法下载 B", async () => {
      const attempted = await bucket(clientA).download(bDoc.storage_path);
      requireTrue(denied(attempted.error), "A 下载 B 未被明确拒绝", attempted.error);
      await checkUnchanged(clientB, bDoc, bBefore);
    });
    await step("A 无法删除 B", async () => {
      const attempted = await bucket(clientA).remove([bDoc.storage_path]);
      requireTrue(!attempted.error || denied(attempted.error), "A 删除 B 的请求结果不确定", attempted.error);
      await checkUnchanged(clientB, bDoc, bBefore);
    });
    await step("B 无法下载 A", async () => {
      const attempted = await bucket(clientB).download(aDoc.storage_path);
      requireTrue(denied(attempted.error), "B 下载 A 未被明确拒绝", attempted.error);
      await checkUnchanged(clientA, aDoc, aBefore);
    });
    await step("B 无法删除 A", async () => {
      const attempted = await bucket(clientB).remove([aDoc.storage_path]);
      requireTrue(!attempted.error || denied(attempted.error), "B 删除 A 的请求结果不确定", attempted.error);
      await checkUnchanged(clientA, aDoc, aBefore);
    });

    // Generate one dedicated B-owned uploading row. A's upload uses its exact
    // generated path, so denial cannot be explained by a nonexistent document.
    stage = "一次性测试夹具初始化";
    const id = randomUUID();
    const payload = new TextEncoder().encode(`isolated Storage check ${id}`);
    temporary = { id, userId: userBId, path: `${userBId}/${id}/source.txt` };
    report(`本轮一次性文档 ID：${id}`);
    const inserted = await clientB.from("knowledge_documents").insert({
      id, user_id: userBId, file_name: `${PREFIX}upload-${id}.txt`,
      file_type: "txt", byte_size: payload.length,
    }).select("id,storage_path,status").single();
    requireTrue(!inserted.error && inserted.data?.id === id &&
      inserted.data.storage_path === temporary.path && inserted.data.status === "uploading",
    "一次性上传文档未正确创建", inserted.error);
    insertedConfirmed = true;
    stage = "一次性 Storage 路径检查";
    const absent = await bucket(clientB).download(temporary.path);
    requireTrue(Boolean(absent.error), "一次性路径已存在对象", absent.error);
    report("一次性测试夹具初始化: PASS");
    stage = "A 无法上传到 B 的一次性路径";
    const uploaded = await bucket(clientA).upload(temporary.path, payload,
      { contentType: "text/plain", upsert: false });
    const observed = await bucket(clientB).download(temporary.path);
    requireTrue(denied(uploaded.error) && Boolean(observed.error),
      "A 上传到 B 的一次性路径未被明确拒绝", uploaded.error);
    stage = "越权上传后双方原件下载复核";
    await checkUnchanged(clientA, aDoc, aBefore);
    await checkUnchanged(clientB, bDoc, bBefore);
    report("A 无法上传到 B 的一次性路径，双方原件未变: PASS");
    passed = true;
  } catch (error) {
    report(`${stage}: FAIL`);
    if (error instanceof AuthFailure) {
      report(`账号: ${error.account}; 阶段: ${error.phase}; 分类: ${error.kind}; HTTP: ${error.status ?? "无"}; Auth code: ${error.authCode ?? "无"}; Network code: ${error.networkCode ?? "无"}`);
    } else if (error instanceof TerminalInputFailure) {
      report("分类: 终端读取失败；请在交互终端重试");
    } else {
      report(`分类: ${failureCategory(stage, error)}; HTTP: ${safeHttpStatus(error)}; code: ${safeErrorCode(error)}`);
      if (error instanceof CheckFailure) report(error.message);
    }
  } finally {
    if (temporary) {
      let cleanupStage = "一次性夹具清理检查";
      try {
        requireTrue(writer && ownerB, "清理连接不可用");
        const row = await ownerB.from("knowledge_documents").select("id").eq("id", temporary.id);
        requireTrue(!row.error, "无法检查一次性文档");
        requireTrue(!insertedConfirmed || row.data?.length === 1, "已创建的一次性文档不可见");
        if (row.data?.length) {
          cleanupStage = "一次性夹具清理状态转换";
          const marked = await writer.query(
            "select knowledge_private.mark_knowledge_deleting($1::uuid,$2::uuid) as value",
            [temporary.userId, temporary.id],
          );
          requireTrue(marked.rows[0]?.value === true, "无法标记一次性文档删除");
          // Storage may report a missing object because the forbidden upload
          // correctly failed. The owner recheck and finish RPC are decisive.
          cleanupStage = "一次性夹具清理 Storage 删除";
          await bucket(ownerB).remove([temporary.path]);
          requireTrue(Boolean((await bucket(ownerB).download(temporary.path)).error), "一次性对象仍存在");
          cleanupStage = "一次性夹具清理数据库完成";
          const finished = await writer.query(
            "select knowledge_private.finish_knowledge_deletion($1::uuid,$2::uuid) as value",
            [temporary.userId, temporary.id],
          );
          requireTrue(finished.rows[0]?.value === true, "无法完成一次性文档删除");
          cleanupStage = "一次性夹具清理结果验证";
          const after = await ownerB.from("knowledge_documents").select("id").eq("id", temporary.id);
          requireTrue(!after.error && after.data?.length === 0, "一次性文档仍存在");
        }
        report("一次性夹具清理: PASS");
      } catch (error) {
        cleanupFailed = true;
        report(`${cleanupStage}: FAIL`);
        report(`分类: 测试夹具清理失败; HTTP: ${safeHttpStatus(error)}; code: ${safeErrorCode(error)}`);
        report(`须人工检查测试对象 ID：${temporary.id}`);
      }
    } else {
      report("本轮未创建一次性测试对象，无需清理");
    }
    if (writer) {
      try { await writer.end(); }
      catch (error) {
        cleanupFailed = true;
        report("受限数据库连接关闭: FAIL");
        report(`分类: 数据库连接关闭失败; HTTP: ${safeHttpStatus(error)}; code: ${safeErrorCode(error)}`);
        if (temporary) report(`须人工检查测试对象 ID：${temporary.id}`);
      }
    }
  }
  return passed && !cleanupFailed;
}

// Raw TTY input avoids shell history, argv, environment variables and echoing
// passwords/keys. Only prompts and non-secret answers are written to stdout.
export function createTerminalPrompt(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new TerminalInputFailure("必须在本地交互终端运行");
  }
  return {
    ask(label, hidden = false) {
      return new Promise((resolve, reject) => {
        let value = "";
        let escape = "";
        let skipWindowsKey = false;
        let finished = false;
        const decoder = new TextDecoder("utf-8", { fatal: true });
        const previousRaw = input.isRaw;
        const finish = (error) => {
          if (finished) return;
          finished = true;
          input.off("data", onData);
          input.off("error", onError);
          input.off("end", onEnd);
          try { input.setRawMode(Boolean(previousRaw)); }
          catch { error = new TerminalInputFailure("终端模式恢复失败"); }
          input.pause();
          output.write("\n");
          if (error) reject(error); else resolve(value);
        };
        const onError = () => finish(new TerminalInputFailure("终端读取失败"));
        const onEnd = () => finish(new TerminalInputFailure("终端已关闭"));
        const onData = (buffer) => {
          try {
            for (const char of decoder.decode(buffer, { stream: true })) {
              if (skipWindowsKey) { skipWindowsKey = false; continue; }
              if (char === "\u0000") { skipWindowsKey = true; continue; }
              if (escape) {
                escape += char;
                if (escape === "\u001b[") continue;
                if (/^\u001b\[[0-9;]*$/u.test(escape)) continue;
                if (escape.length <= 32 && /^\u001b\[[0-9;]*[A-Za-z~]$/u.test(escape)) {
                  escape = "";
                  continue;
                }
                escape = "";
                continue;
              }
              if (char === "\u001b") { escape = char; continue; }
              if (char === "\r" || char === "\n") { finish(); return; }
              if (char === "\u0003") { finish(new TerminalInputFailure("人工中断")); return; }
              if (char === "\b" || char === "\u007f") {
                if (value.length) {
                  value = Array.from(value).slice(0, -1).join("");
                  if (!hidden) output.write("\b \b");
                }
              } else if (char >= " ") {
                value += char;
                if (!hidden) output.write(char);
              }
            }
          } catch { finish(new TerminalInputFailure("终端输入解码失败")); }
        };
        try {
          output.write(label);
          input.setRawMode(true);
          input.on("data", onData);
          input.on("error", onError);
          input.on("end", onEnd);
          input.resume();
        } catch { finish(new TerminalInputFailure("终端读取启动失败")); }
      });
    },
  };
}

export async function runFromTerminal() {
  let success = false;
  try { success = await runInteractiveStorage({ prompt: createTerminalPrompt() }); }
  catch { console.error("交互验收启动失败：请核对测试 Worktree 与终端。未输出凭据。"); }
  if (!success) process.exitCode = 1;
}
