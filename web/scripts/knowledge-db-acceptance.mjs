// Destructive acceptance helpers for one isolated Supabase test project.
// Importing this module never connects to a database or reads credentials.
import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, writeFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, normalize } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  PROJECT_NAME, PROJECT_REF, PROJECT_URL, TEST_WEB_DIRECTORY,
  validateCaPem, validatePublishableKey,
} from "./knowledge-storage-interactive.mjs";

export { PROJECT_NAME, PROJECT_REF };
export const RUN_DIRECTORY = ".kb-acceptance-runs";
export const ESTIMATED_DOCUMENTS = 126;
export const ESTIMATED_STORAGE_OBJECTS = 3;
const HTTP_TIMEOUT_MS = 15000;
const SOURCE = Buffer.from("isolated database concurrency fixture");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EVENT_TABLES = new Set(["knowledge_upload_events", "knowledge_process_events"]);

export class AcceptanceError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export class PreflightFailure extends Error {
  constructor(stage, lastPassed, category, code) {
    super(code);
    this.stage = stage;
    this.lastPassed = lastPassed;
    this.category = category;
    this.code = code;
  }
}
const check = (condition, code) => { if (!condition) throw new AcceptanceError(code); };

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND",
  "EAI_AGAIN", "08001", "08006"]);
const SQL_SCHEMA_CODES = new Set(["42P01", "42703", "42883", "3F000"]);

function classifyFailure(error, stage) {
  if (error instanceof AcceptanceError) {
    const safeCode = typeof error.code === "string" && /^[A-Z][A-Z0-9_]{2,60}$/u.test(error.code)
      ? error.code : "ASSERTION_FAILED";
    return { category: safeCode === "AUTH_REJECTED" ? "AUTH" : "ASSERTION", code: safeCode };
  }
  const code = error?.code ?? error?.cause?.code;
  if (code === "57014" || code === "QUERY_TIMEOUT" || code === "ETIMEDOUT" ||
      code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" ||
      error?.name === "AbortError" || error?.name === "TimeoutError" ||
      error?.message === "Query read timeout") {
    return { category: "TIMEOUT", code: "REQUEST_TIMEOUT" };
  }
  if (NETWORK_CODES.has(code) || error?.name === "AuthRetryableFetchError") {
    return { category: "NETWORK", code: NETWORK_CODES.has(code) ? code : "NETWORK_ERROR" };
  }
  if (code === "28P01" || code === "28000") return { category: "DB_AUTH", code };
  if (code === "42501") return { category: "SQL_PERMISSION", code };
  if (SQL_SCHEMA_CODES.has(code)) return { category: "SQL_SCHEMA", code };
  if (typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code)) {
    return { category: "SQL", code: "SQL_ERROR" };
  }
  if (stage.startsWith("AUTH_")) return { category: "AUTH", code: "AUTH_ERROR" };
  return { category: "UNKNOWN", code: "UNCLASSIFIED_ERROR" };
}

export function safePreflightDiagnostic(error, progress = {}) {
  if (error instanceof PreflightFailure) {
    return { stage: error.stage, lastPassed: error.lastPassed,
      category: error.category, code: error.code };
  }
  const stage = progress.stage ?? "PROJECT_IDENTITY";
  return { stage, lastPassed: progress.lastPassed ?? "NONE", ...classifyFailure(error, stage) };
}

export function parseMode(args) {
  if (args.length === 1 && ["--preflight", "--execute"].includes(args[0])) {
    return { mode: args[0].slice(2) };
  }
  if (args.length === 2 && args[0] === "--inspect-run" && UUID.test(args[1])) {
    return { mode: "inspect", runId: args[1].toLowerCase() };
  }
  throw new AcceptanceError("INVALID_MODE");
}

export function requireTestWorktree(cwd, resolve = realpathSync.native) {
  let actual;
  let expected;
  try {
    actual = normalize(resolve(cwd)).toLowerCase();
    expected = normalize(resolve(TEST_WEB_DIRECTORY)).toLowerCase();
  } catch {
    // The fixed Windows acceptance worktree does not exist in an Ubuntu CI
    // checkout. A failed canonicalization must be a safe worktree rejection.
    throw new AcceptanceError("WRONG_WORKTREE");
  }
  check(actual === expected, "WRONG_WORKTREE");
}

function parsePooler(raw, role, ca) {
  let url;
  try { url = new URL(raw); } catch { throw new AcceptanceError("INVALID_POOLER_URL"); }
  check(url.protocol === "postgresql:" && url.port === "6543" && url.pathname === "/postgres" &&
    !url.search && !url.hash && Boolean(url.password), "INVALID_POOLER_URL");
  check(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/u.test(url.hostname),
    "INVALID_POOLER_HOST");
  check(decodeURIComponent(url.username) === `${role}.${PROJECT_REF}`, "WRONG_POOLER_ROLE");
  return {
    host: url.hostname, port: 6543, database: "postgres",
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    connectionTimeoutMillis: 5000, query_timeout: 15000,
    ssl: { ca, servername: url.hostname, rejectUnauthorized: true },
  };
}

export function validateConfiguration(mode, env, cwd, resolve = realpathSync.native) {
  requireTestWorktree(cwd, resolve);
  check(env.KB_DB_TEST_PROJECT_KIND === "isolated-test-project", "WRONG_PROJECT_KIND");
  check(env.KB_DB_TEST_PROJECT_REF === PROJECT_REF, "WRONG_PROJECT_REF");
  if (mode === "execute") {
    check(env.KB_DB_TEST_ACK === "I_ACCEPT_MUTATING_ISOLATED_PROJECT", "MISSING_EXECUTE_ACK");
  }
  let ca;
  try { ca = validateCaPem(Buffer.from(env.KB_DB_TEST_CA_CERT_BASE64 ?? "", "base64").toString("utf8")); }
  catch { throw new AcceptanceError("INVALID_TEST_CA"); }
  const admin = parsePooler(env.KB_DB_TEST_FIXTURE_ADMIN_URL, "postgres", ca);
  if (mode === "inspect") return { admin, projectRef: PROJECT_REF };
  check(env.KB_DB_TEST_URL === PROJECT_URL, "WRONG_SUPABASE_URL");
  let key;
  try { key = validatePublishableKey(env.KB_DB_TEST_PUBLISHABLE_KEY ?? ""); }
  catch { throw new AcceptanceError("INVALID_PUBLISHABLE_KEY"); }
  const writer = parsePooler(env.KB_DB_TEST_WRITER_URL, "knowledge_writer_login", ca);
  check(writer.host === admin.host, "POOLER_HOST_MISMATCH");
  const c = { id: env.KB_DB_TEST_USER_C_ID, jwt: env.KB_DB_TEST_JWT_C };
  const d = { id: env.KB_DB_TEST_USER_D_ID, jwt: env.KB_DB_TEST_JWT_D };
  check(UUID.test(c.id ?? "") && UUID.test(d.id ?? "") && c.id !== d.id && c.jwt && d.jwt,
    "INVALID_TEST_USERS");
  return { admin, writer, key, c, d, projectRef: PROJECT_REF };
}

export function boundedProjectFetch(fetcher = globalThis.fetch.bind(globalThis), timeoutMs = HTTP_TIMEOUT_MS) {
  return (input, init) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
    check(url.origin === PROJECT_URL, "WRONG_HTTP_TARGET");
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    return fetcher(input, { ...init, signal });
  };
}

export function createRunManifest(runId, cId, dId, now = new Date()) {
  check(UUID.test(runId) && UUID.test(cId) && UUID.test(dId) && cId !== dId, "INVALID_RUN_IDENTITY");
  return {
    version: 1, runId, projectRef: PROJECT_REF, projectName: PROJECT_NAME,
    startedAt: now.toISOString(), updatedAt: now.toISOString(), status: "running",
    stage: "created", users: { C: cId, D: dId }, documents: [],
    eventsRetained: true,
  };
}

export function validateManifest(data, runId) {
  check(data?.version === 1 && data.runId === runId && data.projectRef === PROJECT_REF &&
    data.projectName === PROJECT_NAME && UUID.test(data.users?.C ?? "") &&
    UUID.test(data.users?.D ?? "") && data.users.C !== data.users.D &&
    Array.isArray(data.documents) && data.eventsRetained === true, "INVALID_RUN_MANIFEST");
  const seen = new Set();
  for (const item of data.documents) {
    check(UUID.test(item.id ?? "") && [data.users.C, data.users.D].includes(item.userId) &&
      item.path === `${item.userId}/${item.id}/source.txt` && !seen.has(item.id),
    "INVALID_RUN_MANIFEST");
    seen.add(item.id);
  }
  return data;
}

export function createManifestStore(cwd, ops = { mkdir, readFile, rename, writeFile, rm }) {
  const directory = join(cwd, RUN_DIRECTORY);
  let pending = Promise.resolve();
  const pathFor = (runId) => {
    check(UUID.test(runId), "INVALID_RUN_ID");
    return join(directory, `${runId}.json`);
  };
  const write = async (manifest, initial = false) => {
    validateManifest(manifest, manifest.runId);
    manifest.updatedAt = new Date().toISOString();
    await ops.mkdir(directory, { recursive: true });
    const path = pathFor(manifest.runId);
    if (initial) {
      await ops.writeFile(path, JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
      return;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await ops.writeFile(temporary, JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
      await ops.rename(temporary, path);
    } catch (error) {
      await ops.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  };
  // Concurrent claim attempts can finish out of order; serialize manifest writes.
  const save = (manifest, initial = false) => {
    const task = pending.then(() => write(manifest, initial));
    pending = task.catch(() => undefined);
    return task;
  };
  return {
    pathFor,
    create: async (manifest) => save(manifest, true),
    save: async (manifest) => save(manifest),
    load: async (runId) => validateManifest(JSON.parse(await ops.readFile(pathFor(runId), "utf8")), runId),
  };
}

async function connect(config, createPg, clients) {
  const client = createPg(config);
  clients.push(client);
  await client.connect();
  return client;
}
const scalar = async (client, sql, values = []) => (await client.query(sql, values)).rows[0]?.value;
const claimSql = "select knowledge_private.claim_knowledge_document($1::uuid,$2::uuid) as value";
const failSql = "select knowledge_private.fail_knowledge_document($1::uuid,$2::uuid,$3::integer,$4::text) as value";
const completeSql = "select knowledge_private.complete_knowledge_document($1::uuid,$2::uuid,$3::integer,$4::jsonb) as value";
const markSql = "select knowledge_private.mark_knowledge_deleting($1::uuid,$2::uuid) as value";
const finishSql = "select knowledge_private.finish_knowledge_deletion($1::uuid,$2::uuid) as value";

function assertEmptyCounts(row, fields) {
  check(row && fields.every((field) => {
    const value = row[field];
    const count = typeof value === "number" ? value :
      typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : NaN;
    return Number.isSafeInteger(count) && count === 0;
  }), "TEST_USER_NOT_EMPTY");
}

export async function runPreflight(config, {
  createSupabase = createClient, createPg = (settings) => new pg.Client(settings),
  fetcher = boundedProjectFetch(),
  onStage = () => undefined,
} = {}) {
  const connections = [];
  let lastPassed = "PROJECT_IDENTITY";
  const step = async (stage, action) => {
    onStage({ stage, lastPassed });
    try {
      const result = await action();
      lastPassed = stage;
      onStage({ stage, lastPassed, passed: true });
      return result;
    } catch (error) {
      const diagnosis = classifyFailure(error, stage);
      throw new PreflightFailure(stage, lastPassed, diagnosis.category, diagnosis.code);
    }
  };
  const session = (identity) => createSupabase(PROJECT_URL, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${identity.jwt}` }, fetch: fetcher },
  });
  try {
    const c = await step("AUTH_C", async () => {
      const client = session(config.c);
      const verified = await client.auth.getUser(config.c.jwt);
      if (verified.error) throw verified.error;
      check(verified.data?.user?.id === config.c.id, "TEST_USER_IDENTITY_MISMATCH");
      return client;
    });
    const d = await step("AUTH_D", async () => {
      const client = session(config.d);
      const verified = await client.auth.getUser(config.d.jwt);
      if (verified.error) throw verified.error;
      check(verified.data?.user?.id === config.d.id, "TEST_USER_IDENTITY_MISMATCH");
      return client;
    });
    const admin = await step("ADMIN_CONNECTION", () => connect(config.admin, createPg, connections));
    const first = await step("WRITER_CONNECTION_1", () => connect(config.writer, createPg, connections));
    const second = await step("WRITER_CONNECTION_2", () => connect(config.writer, createPg, connections));
    await step("READ_ONLY_TRANSACTION", () => admin.query("begin isolation level repeatable read read only"));
    for (const [client, expected, stage] of [[admin, "postgres", "ADMIN_ROLE_CHECK"],
      [first, "knowledge_writer_login", "WRITER_ROLE_CHECK_1"],
      [second, "knowledge_writer_login", "WRITER_ROLE_CHECK_2"]]) {
      await step(stage, async () => {
        const identity = (await client.query("select current_user as role_name, current_database() as db_name")).rows[0];
        check(identity?.role_name === expected && identity?.db_name === "postgres", "DATABASE_IDENTITY_MISMATCH");
      });
    }
    await step("WRITER_PERMISSION_CHECK", async () => {
      const permissions = (await first.query(
      "select has_function_privilege(current_user, 'knowledge_private.claim_knowledge_document(uuid,uuid)', 'EXECUTE') as claim_allowed, has_function_privilege(current_user, 'knowledge_private.complete_knowledge_document(uuid,uuid,integer,jsonb)', 'EXECUTE') as complete_allowed, has_function_privilege(current_user, 'knowledge_private.fail_knowledge_document(uuid,uuid,integer,text)', 'EXECUTE') as fail_allowed, has_function_privilege(current_user, 'knowledge_private.mark_knowledge_deleting(uuid,uuid)', 'EXECUTE') as mark_allowed, has_function_privilege(current_user, 'knowledge_private.finish_knowledge_deletion(uuid,uuid)', 'EXECUTE') as finish_allowed",
      )).rows[0];
      check(permissions && Object.values(permissions).every((value) => value === true), "WRITER_PERMISSION_MISMATCH");
    });
    for (const [label, identity] of [["C", config.c], ["D", config.d]]) {
      await step(`EMPTY_DOCUMENT_CHECK_${label}`, async () => {
        const { rows } = await admin.query(
          "select (select count(*)::integer from public.knowledge_documents where user_id=$1) as documents, (select count(*)::integer from public.knowledge_chunks where user_id=$1) as chunks",
          [identity.id],
        );
        assertEmptyCounts(rows[0], ["documents", "chunks"]);
      });
      await step(`EMPTY_STORAGE_CHECK_${label}`, async () => {
        const { rows } = await admin.query(
          "select count(*)::integer as objects from storage.objects where bucket_id='knowledge-files' and left(name,length($1::text)+1)=$1::text||'/'",
          [identity.id],
        );
        assertEmptyCounts(rows[0], ["objects"]);
      });
      await step(`EMPTY_EVENT_CHECK_${label}`, async () => {
        const { rows } = await admin.query(
          "select (select count(*)::integer from knowledge_private.knowledge_upload_events where user_id=$1) as uploads, (select count(*)::integer from knowledge_private.knowledge_process_events where user_id=$1) as processes",
          [identity.id],
        );
        assertEmptyCounts(rows[0], ["uploads", "processes"]);
      });
    }
    await step("READ_ONLY_ROLLBACK", () => admin.query("rollback"));
    onStage({ stage: "PREFLIGHT_COMPLETE", lastPassed: "PREFLIGHT_COMPLETE", passed: true });
    return { c, d, admin, first, second, connections, projectRef: PROJECT_REF,
      ids: { C: config.c.id, D: config.d.id } };
  } catch (error) {
    await Promise.allSettled(connections.map((client) => client.end()));
    throw error;
  }
}

export async function closeConnections(context) {
  const closed = await Promise.allSettled(context.connections.map((client) => client.end()));
  check(closed.every((result) => result.status === "fulfilled"), "CONNECTION_CLOSE_FAILED");
}

async function eventCount(admin, table, userId, currentHour = false) {
  check(EVENT_TABLES.has(table), "INVALID_EVENT_TABLE");
  const filter = currentHour
    ? " and created_at >= date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC'" : "";
  const count = Number((await admin.query(
    `select count(*)::integer as value from knowledge_private.${table} where user_id=$1${filter}`,
    [userId],
  )).rows[0]?.value);
  check(Number.isInteger(count) && count >= 0, "EVENT_COUNT_UNAVAILABLE");
  return count;
}

export async function inspectRun(manifest, admin) {
  validateManifest(manifest, manifest.runId);
  const ids = manifest.documents.map((item) => item.id);
  const paths = manifest.documents.map((item) => item.path);
  const documents = ids.length ? (await admin.query(
    "select id,user_id,storage_path,status from public.knowledge_documents where id=any($1::uuid[])", [ids],
  )).rows : [];
  const objects = paths.length ? (await admin.query(
    "select name from storage.objects where bucket_id='knowledge-files' and name=any($1::text[])", [paths],
  )).rows : [];
  const byId = new Map(documents.map((row) => [row.id, row]));
  const objectPaths = new Set(objects.map((row) => row.name));
  return {
    runId: manifest.runId, status: manifest.status, stage: manifest.stage,
    entries: manifest.documents.map((item) => {
      const row = byId.get(item.id);
      check(!row || row.user_id === item.userId && row.storage_path === item.path,
        "FIXTURE_OWNERSHIP_MISMATCH");
      return { id: item.id, userId: item.userId, phase: item.phase,
        cleanup: item.cleanup, documentStatus: row?.status ?? "absent",
        objectExists: objectPaths.has(item.path) };
    }),
    events: {
      C: { uploads: await eventCount(admin, "knowledge_upload_events", manifest.users.C),
        processes: await eventCount(admin, "knowledge_process_events", manifest.users.C) },
      D: { uploads: await eventCount(admin, "knowledge_upload_events", manifest.users.D),
        processes: await eventCount(admin, "knowledge_process_events", manifest.users.D) },
    },
  };
}

function assertExactFixture(item, row) {
  check(row?.id === item.id && row.user_id === item.userId && row.storage_path === item.path,
    "FIXTURE_OWNERSHIP_MISMATCH");
}

export async function cleanupRegistered(manifest, store, context) {
  validateManifest(manifest, manifest.runId);
  check(context.projectRef === PROJECT_REF, "WRONG_PROJECT_REF");
  check(context.ids?.C === manifest.users.C && context.ids?.D === manifest.users.D,
    "FIXTURE_USER_MISMATCH");
  for (const [client, expected] of [[context.admin, "postgres"],
    [context.first, "knowledge_writer_login"]]) {
    const identity = (await client.query("select current_user as role_name, current_database() as db_name")).rows[0];
    check(identity?.role_name === expected && identity?.db_name === "postgres",
      "DATABASE_IDENTITY_MISMATCH");
  }
  for (const item of manifest.documents) {
    if (item.cleanup === "complete" || item.phase === "rejected") continue;
    const row = (await context.admin.query(
      "select id,user_id,storage_path from public.knowledge_documents where id=$1::uuid", [item.id],
    )).rows[0];
    const exists = async () => Boolean((await context.admin.query(
      "select exists(select 1 from storage.objects where bucket_id='knowledge-files' and name=$1) as value",
      [item.path],
    )).rows[0]?.value);
    if (row) {
      assertExactFixture(item, row);
      item.phase = "cleanup-mark-pending";
      await store.save(manifest);
      check(await scalar(context.first, markSql, [item.userId, item.id]) === true, "CLEANUP_MARK_FAILED");
      if (await exists()) {
        item.phase = "cleanup-storage-pending";
        await store.save(manifest);
        const owner = item.userId === manifest.users.C ? context.c : context.d;
        const removed = await owner.storage.from("knowledge-files").remove([item.path]);
        check(!removed.error, "CLEANUP_STORAGE_UNCERTAIN");
      }
      check(!await exists(), "CLEANUP_STORAGE_UNCERTAIN");
      item.phase = "cleanup-finish-pending";
      await store.save(manifest);
      check(await scalar(context.first, finishSql, [item.userId, item.id]) === true,
        "CLEANUP_FINISH_FAILED");
    } else {
      check(!await exists(), "ORPHAN_STORAGE_OBJECT");
    }
    const remaining = (await context.admin.query(
      "select id from public.knowledge_documents where id=$1::uuid", [item.id],
    )).rows[0];
    check(!remaining && !await exists(), "CLEANUP_VERIFY_FAILED");
    item.cleanup = "complete";
    item.phase = "cleaned";
    await store.save(manifest);
  }
  manifest.status = "complete";
  manifest.stage = "cleanup-complete; event rows retained";
  await store.save(manifest);
}

export async function executeScenario(context, manifest, store, shouldStop = () => false) {
  const { admin, first, second, c, d, ids } = context;
  const stage = async (name, action) => {
    check(!shouldStop(), "INTERRUPTED_NEEDS_INSPECTION");
    manifest.stage = `${name}:pending`;
    await store.save(manifest);
    const value = await action();
    manifest.stage = `${name}:done`;
    await store.save(manifest);
    return value;
  };
  const register = async (userId, byteSize, upload = false) => {
    const id = randomUUID();
    const item = { id, userId, path: `${userId}/${id}/source.txt`, byteSize,
      phase: "insert-pending", cleanup: "pending" };
    manifest.documents.push(item);
    await store.save(manifest); // durable before the first insert request
    const owner = userId === ids.C ? c : d;
    const inserted = await stage(`insert:${id}`, () => owner.from("knowledge_documents")
      .insert({ id, user_id: userId, file_name: `kb-db-${manifest.runId}-${id}.txt`,
        file_type: "txt", byte_size: byteSize }).select("id,storage_path").single());
    check(!inserted.error && inserted.data?.id === id && inserted.data.storage_path === item.path,
      "INSERT_UNCERTAIN_NEEDS_INSPECTION");
    item.phase = "inserted";
    await store.save(manifest);
    if (upload) {
      item.phase = "upload-pending";
      await store.save(manifest);
      const uploaded = await stage(`upload:${id}`, () => owner.storage.from("knowledge-files")
        .upload(item.path, SOURCE, { contentType: "text/plain", upsert: false }));
      check(!uploaded.error, "UPLOAD_UNCERTAIN_NEEDS_INSPECTION");
      item.phase = "uploaded";
      await store.save(manifest);
    }
    return item;
  };
  const expectedInsertFailure = async (userId, byteSize, expected) => {
    const id = randomUUID();
    const item = { id, userId, path: `${userId}/${id}/source.txt`, byteSize,
      phase: "expected-reject-pending", cleanup: "pending" };
    manifest.documents.push(item);
    await store.save(manifest);
    const owner = userId === ids.C ? c : d;
    const result = await stage(`expected-reject:${id}`, () => owner.from("knowledge_documents")
      .insert({ id, user_id: userId, file_name: `kb-db-${manifest.runId}-${id}.txt`,
        file_type: "txt", byte_size: byteSize }).select("id,storage_path").maybeSingle());
    check(result.error?.code === "P0001" && result.error?.message === expected,
      "LIMIT_RESULT_UNEXPECTED_NEEDS_INSPECTION");
    item.phase = "rejected";
    item.cleanup = "complete";
    await store.save(manifest);
  };
  const claim = (client, userId, id) => stage(`claim:${id}`,
    () => scalar(client, claimSql, [userId, id]));
  const fail = (client, userId, id, generation) => stage(`fail:${id}`,
    () => scalar(client, failSql, [userId, id, generation, "temporary"]));
  const complete = (client, userId, id, generation) => stage(`complete:${id}`,
    () => scalar(client, completeSql, [userId, id, generation, JSON.stringify(["verified test chunk"])]));
  const shift = (table, userId) => stage(`shift-events:${table}`, async () => {
    check(EVENT_TABLES.has(table), "INVALID_EVENT_TABLE");
    await admin.query(
      `update knowledge_private.${table} set created_at=now()-interval '2 hours' where user_id=$1 and created_at >= $2::timestamptz and created_at >= date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC'`,
      [userId, manifest.startedAt],
    );
  });
  const countDocs = async (owner) => {
    const result = await owner.from("knowledge_documents").select("id", { count: "exact", head: true });
    check(!result.error && Number.isInteger(result.count) && result.count >= 0,
      "DOCUMENT_COUNT_UNAVAILABLE");
    return result.count;
  };

  const race = await register(ids.C, SOURCE.length, true);
  const stale = await register(ids.C, SOURCE.length, true);
  const deleting = await register(ids.C, SOURCE.length, true);
  const missing = await register(ids.C, 1);
  check(await claim(first, ids.C, missing.id) === -1, "MISSING_SOURCE_CLAIMED");
  check(await claim(first, ids.D, race.id) === 0, "CROSS_USER_CLAIMED");

  await stage("race-begin", () => first.query("begin"));
  let inTransaction = true;
  try {
    check(await claim(first, ids.C, race.id) === 1, "FIRST_CLAIM_FAILED");
    const waiting = claim(second, ids.C, race.id).then(
      (value) => ({ value }), (error) => ({ error }),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    await stage("race-commit", () => first.query("commit"));
    inTransaction = false;
    const result = await waiting;
    if (result.error) throw result.error;
    check(result.value === 0, "SECOND_CLAIM_UNEXPECTED");
  } finally {
    if (inTransaction) await first.query("rollback");
  }
  check(await fail(first, ids.C, race.id, 1) === true, "RACE_FAIL_TRANSITION_FAILED");

  const oldGeneration = await claim(first, ids.C, stale.id);
  check(oldGeneration === 1, "OLD_GENERATION_UNEXPECTED");
  const expiry = await stage("fixture-expire-generation", () => admin.query(
    "update public.knowledge_documents set updated_at=now()-interval '11 minutes' where id=$1 and user_id=$2 and storage_path=$3 and status='processing'",
    [stale.id, ids.C, stale.path],
  ));
  check(expiry.rowCount === 1, "FIXTURE_EXPIRY_UNEXPECTED");
  const nextGeneration = await claim(second, ids.C, stale.id);
  check(nextGeneration === 2, "NEW_GENERATION_UNEXPECTED");
  check(await complete(first, ids.C, stale.id, oldGeneration) === false, "STALE_COMPLETION_ACCEPTED");
  check(await complete(second, ids.C, stale.id, nextGeneration) === true, "CURRENT_COMPLETION_FAILED");

  const deleteGeneration = await claim(first, ids.C, deleting.id);
  await stage("delete-race-begin", () => first.query("begin"));
  inTransaction = true;
  try {
    check(await stage("delete-race-mark", () => scalar(first, markSql, [ids.C, deleting.id])) === true,
      "DELETE_MARK_FAILED");
    const waiting = complete(second, ids.C, deleting.id, deleteGeneration).then(
      (value) => ({ value }), (error) => ({ error }),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    await stage("delete-race-commit", () => first.query("commit"));
    inTransaction = false;
    const result = await waiting;
    if (result.error) throw result.error;
    check(result.value === false, "DELETE_RACE_ACCEPTED_OLD_PROCESSOR");
  } finally {
    if (inTransaction) await first.query("rollback");
  }
  const removed = await stage("delete-race-storage-remove", () => c.storage.from("knowledge-files")
    .remove([deleting.path]));
  check(!removed.error, "DELETE_RACE_STORAGE_UNCERTAIN");
  check(await stage("delete-race-finish", () => scalar(first, finishSql, [ids.C, deleting.id])) === true,
    "DELETE_RACE_FINISH_FAILED");

  while (await eventCount(admin, "knowledge_upload_events", ids.C, true) < 20) {
    await register(ids.C, 1);
  }
  await expectedInsertFailure(ids.C, 1, "UPLOAD_RATE_LIMITED");
  while (await countDocs(c) < 100) {
    if (await eventCount(admin, "knowledge_upload_events", ids.C, true) >= 20) {
      await shift("knowledge_upload_events", ids.C);
    }
    await register(ids.C, 1);
  }
  await shift("knowledge_upload_events", ids.C);
  await expectedInsertFailure(ids.C, 1, "KNOWLEDGE_LIMIT_REACHED");

  for (let index = 0; index < 25; index += 1) {
    if (await eventCount(admin, "knowledge_upload_events", ids.D, true) >= 20) {
      await shift("knowledge_upload_events", ids.D);
    }
    await register(ids.D, 4194304);
  }
  await expectedInsertFailure(ids.D, 1, "KNOWLEDGE_LIMIT_REACHED");
  await shift("knowledge_process_events", ids.C);
  for (let index = 0; index < 60; index += 1) {
    const generation = await claim(first, ids.C, race.id);
    check(Number.isInteger(generation) && generation > 0, "PROCESS_CLAIM_FAILED");
    check(await fail(first, ids.C, race.id, generation) === true, "PROCESS_FAIL_TRANSITION_FAILED");
  }
  check(await claim(second, ids.C, race.id) === -2, "PROCESS_RATE_LIMIT_NOT_ENFORCED");
  manifest.status = "checks-passed";
  manifest.stage = "all checks passed; cleanup pending";
  await store.save(manifest);
}

export async function inspectFromConfig(config, runId, {
  createPg = (settings) => new pg.Client(settings),
  store = createManifestStore(TEST_WEB_DIRECTORY),
} = {}) {
  const manifest = await store.load(runId);
  const connections = [];
  try {
    const admin = await connect(config.admin, createPg, connections);
    await admin.query("begin read only");
    const identity = (await admin.query("select current_user as role_name, current_database() as db_name")).rows[0];
    check(identity?.role_name === "postgres" && identity?.db_name === "postgres", "DATABASE_IDENTITY_MISMATCH");
    const result = await inspectRun(manifest, admin);
    await admin.query("rollback");
    return result;
  } finally {
    await Promise.allSettled(connections.map((client) => client.end()));
  }
}

export function newRunId() { return randomUUID(); }
