// Explicit modes only. Never run this script from the development checkout.
// No .env.local file is read; credentials come from the invoking process only.
import { createInterface } from "node:readline/promises";
import {
  AcceptanceError,
  ESTIMATED_DOCUMENTS, ESTIMATED_STORAGE_OBJECTS,
  PROJECT_NAME, PROJECT_REF,
  cleanupRegistered, closeConnections, createManifestStore, createRunManifest,
  executeScenario, inspectFromConfig, newRunId, parseMode, runPreflight,
  validateConfiguration,
} from "./knowledge-db-acceptance.mjs";

let context;
let manifest;
let store;
let interrupted = false;
let mode;
const onInterrupt = () => {
  interrupted = true;
  console.error("中断已记录；当前操作将在截止时间内结束，随后停止写入并保留运行清单。");
};

try {
  const selected = parseMode(process.argv.slice(2));
  mode = selected.mode;
  const config = validateConfiguration(mode, process.env, process.cwd());
  store = createManifestStore(process.cwd());

  if (mode === "inspect") {
    const inspection = await inspectFromConfig(config, selected.runId, { store });
    console.log(`Run ID: ${inspection.runId}; 项目: ${PROJECT_NAME} (${PROJECT_REF})`);
    console.log(`状态: ${inspection.status}; 阶段: ${inspection.stage}`);
    for (const entry of inspection.entries) {
      console.log(`文档 ID: ${entry.id}; 登记阶段: ${entry.phase}; 清理: ${entry.cleanup}; 数据库: ${entry.documentStatus}; Storage 对象: ${entry.objectExists ? "存在" : "不存在"}`);
    }
    console.log(`事件保留：C 上传 ${inspection.events.C.uploads}、处理 ${inspection.events.C.processes}；D 上传 ${inspection.events.D.uploads}、处理 ${inspection.events.D.processes}`);
  } else {
    context = await runPreflight(config);
    console.log(`只读预检: PASS；项目 ${PROJECT_NAME} (${PROJECT_REF})；C/D 身份不同，文档、Storage 对象和事件均为空。`);
    if (mode === "execute") {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("TTY_REQUIRED");
      const runId = newRunId();
      console.log(`本轮 Run ID: ${runId}`);
      console.log(`预计创建约 ${ESTIMATED_DOCUMENTS} 条文档记录、${ESTIMATED_STORAGE_OBJECTS} 个 Storage 原件；100 MiB 仅验证数据库声明容量。`);
      console.log("管理员连接仅用于本轮一条文档的过期时间和 C/D 本轮当前小时事件时间调整；清理按登记 ID 与路径逐项执行。上传/处理事件保留，不自动按用户删除。");
      console.log("C/D 必须是全新专用账号，验收期间不得由其他进程使用；网络结果不确定时停止写入并使用 --inspect-run 复核。");
      const reader = createInterface({ input: process.stdin, output: process.stdout });
      let answer;
      try { answer = await reader.question(`核对项目后输入完整名称 ${PROJECT_NAME}，再开始写入：`); }
      finally { reader.close(); }
      if (answer !== PROJECT_NAME) throw new Error("PROJECT_CONFIRMATION_MISSING");
      const newManifest = createRunManifest(runId, config.c.id, config.d.id);
      await store.create(newManifest);
      manifest = newManifest;
      process.on("SIGINT", onInterrupt);
      process.on("SIGTERM", onInterrupt);
      await executeScenario(context, manifest, store, () => interrupted);
      if (interrupted) throw new Error("INTERRUPTED_NEEDS_INSPECTION");
      await cleanupRegistered(manifest, store, context);
      console.log(`并发、代次、删除竞态与资源限额验收: PASS；Run ID: ${runId}；夹具已逐项核销，事件保留供审计。`);
    }
  }
} catch (error) {
  // Never print raw Supabase/pg errors: they may include credentials or bodies.
  const publicCodes = new Set(["28P01", "28000", "42501", "08001", "08006", "57P01",
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);
  const safe = typeof error?.code === "string" &&
    (publicCodes.has(error.code) || error instanceof AcceptanceError)
    ? error.code : "UNKNOWN_FAILURE";
  console.error(`Knowledge DB ${mode ?? "startup"}: FAIL; stage: ${manifest?.stage ?? "preflight"}; code: ${safe}`);
  if (manifest && store) {
    manifest.status = "needs-inspection";
    try { await store.save(manifest); }
    catch { console.error("运行清单更新失败；使用 Run ID 只读检查现存清单及测试项目。"); }
    console.error(`Run ID: ${manifest.runId}; 停止后续写入。仅使用 --inspect-run 进行只读复核。`);
  } else {
    console.error("本轮未开始写入，也未创建一次性测试对象。");
  }
  process.exitCode = 1;
} finally {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onInterrupt);
  if (context) {
    try { await closeConnections(context); }
    catch {
      console.error("数据库连接关闭状态不确定；未输出原始错误。");
      process.exitCode = 1;
    }
  }
}
