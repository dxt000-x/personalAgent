import { describe, expect, it } from "vitest";
import tls from "node:tls";
import {
  AcceptanceError,
  boundedProjectFetch, cleanupRegistered, createManifestStore, createRunManifest,
  executeScenario, inspectFromConfig, parseMode, requireTestWorktree, runPreflight,
  safePreflightDiagnostic, validateConfiguration,
} from "./knowledge-db-acceptance.mjs";
import { PROJECT_REF, PROJECT_URL, TEST_WEB_DIRECTORY } from "./knowledge-storage-interactive.mjs";

const C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const D = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const host = "aws-0-us-east-1.pooler.supabase.com";
const url = (role) => `postgresql://${role}.${PROJECT_REF}:fake-password@${host}:6543/postgres`;
const environment = () => ({
  KB_DB_TEST_PROJECT_KIND: "isolated-test-project", KB_DB_TEST_PROJECT_REF: PROJECT_REF,
  KB_DB_TEST_ACK: "I_ACCEPT_MUTATING_ISOLATED_PROJECT", KB_DB_TEST_URL: PROJECT_URL,
  KB_DB_TEST_PUBLISHABLE_KEY: "sb_publishable_fake-test-only",
  KB_DB_TEST_CA_CERT_BASE64: Buffer.from(tls.rootCertificates[0]).toString("base64"),
  KB_DB_TEST_FIXTURE_ADMIN_URL: url("postgres"), KB_DB_TEST_WRITER_URL: url("knowledge_writer_login"),
  KB_DB_TEST_USER_C_ID: C, KB_DB_TEST_USER_D_ID: D,
  KB_DB_TEST_JWT_C: "fake-c-jwt", KB_DB_TEST_JWT_D: "fake-d-jwt",
});
const config = (mode = "execute", overrides = {}) => validateConfiguration(mode,
  { ...environment(), ...overrides }, TEST_WEB_DIRECTORY, (value) => value);

function fakeStore() {
  const files = new Map();
  const ops = {
    mkdir: async () => {},
    readFile: async (path) => files.get(path),
    writeFile: async (path, data, options) => {
      if (options.flag === "wx" && files.has(path)) throw new Error("EXISTS");
      files.set(path, data);
    },
    rename: async (oldPath, newPath) => { files.set(newPath, files.get(oldPath)); files.delete(oldPath); },
    rm: async (path) => { files.delete(path); },
  };
  return { store: createManifestStore(TEST_WEB_DIRECTORY, ops), files };
}

function fakeDatabase({ existing = false, storageExisting = false, eventsExisting = false,
  stringCounts = false, onQuery } = {}) {
  const calls = [];
  const createPg = (settings) => ({
    async connect() {}, async end() {},
    async query(sql, values = []) {
      calls.push({ role: settings.user.split(".")[0], sql, values });
      onQuery?.(sql, values, settings.user.split(".")[0]);
      if (sql.includes("current_user as role_name")) return { rows: [{ role_name: settings.user.split(".")[0], db_name: "postgres" }] };
      if (sql.includes("has_function_privilege")) return { rows: [{ claim_allowed: true,
        complete_allowed: true, fail_allowed: true, mark_allowed: true, finish_allowed: true }] };
      if (sql.includes("as documents")) return { rows: [{ documents: existing ? 1 : stringCounts ? "0" : 0,
        chunks: stringCounts ? "0" : 0,
        objects: 0, uploads: 0, processes: 0 }] };
      if (sql.includes("count(*)::integer as objects")) {
        return { rows: [{ objects: storageExisting ? 1 : stringCounts ? "0" : 0 }] };
      }
      if (sql.includes("as uploads") && sql.includes("as processes")) {
        return { rows: [{ uploads: eventsExisting ? 1 : stringCounts ? "0" : 0,
          processes: stringCounts ? "0" : 0 }] };
      }
      if (sql.includes("count(*)::integer as value")) return { rows: [{ value: 0 }] };
      if (sql.includes("from public.knowledge_documents where id=any")) return { rows: [] };
      if (sql.includes("from storage.objects where bucket_id") && sql.includes("any(")) return { rows: [] };
      return { rows: [] };
    },
  });
  const createSupabase = (_project, _key, options) => ({ auth: { getUser: async (jwt) => ({
    data: { user: { id: jwt === "fake-c-jwt" ? C : D } }, error: null,
  }) }, options });
  return { calls, createPg, createSupabase };
}

describe("Knowledge DB acceptance safety boundaries", () => {
  it("requires an explicit mode and an exact test worktree", () => {
    expect(parseMode(["--preflight"])).toEqual({ mode: "preflight" });
    expect(parseMode(["--execute"])).toEqual({ mode: "execute" });
    expect(parseMode(["--inspect-run", RUN])).toEqual({ mode: "inspect", runId: RUN });
    expect(() => parseMode([])).toThrow("INVALID_MODE");
    expect(() => requireTestWorktree("D:\\龙虾\\Codex\\PersonalAgent\\web", (x) => x))
      .toThrow("WRONG_WORKTREE");
  });

  it("pins project, users, two pooler roles, port and strict TLS", () => {
    const valid = config();
    expect(valid.admin.ssl).toMatchObject({ rejectUnauthorized: true, servername: host });
    expect(valid.writer.user).toBe(`knowledge_writer_login.${PROJECT_REF}`);
    for (const [field, value, code] of [
      ["KB_DB_TEST_PROJECT_REF", "another-project", "WRONG_PROJECT_REF"],
      ["KB_DB_TEST_URL", "https://another.supabase.co", "WRONG_SUPABASE_URL"],
      ["KB_DB_TEST_FIXTURE_ADMIN_URL", url("knowledge_writer_login"), "WRONG_POOLER_ROLE"],
      ["KB_DB_TEST_WRITER_URL", url("postgres"), "WRONG_POOLER_ROLE"],
      ["KB_DB_TEST_USER_D_ID", C, "INVALID_TEST_USERS"],
      ["KB_DB_TEST_ACK", "", "MISSING_EXECUTE_ACK"],
    ]) expect(() => config("execute", { [field]: value })).toThrow(code);
    expect(() => config("execute", { KB_DB_TEST_WRITER_URL: url("knowledge_writer_login")
      .replace(":6543", ":5432") })).toThrow("INVALID_POOLER_URL");
  });

  it("bounds HTTP calls and refuses non-test targets", async () => {
    const seen = [];
    const fetcher = boundedProjectFetch(async (_input, init) => { seen.push(init.signal); return { ok: true }; });
    await fetcher(`${PROJECT_URL}/auth/v1/user`);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(() => fetcher("https://example.com/auth/v1/user")).toThrow("WRONG_HTTP_TARGET");
  });

  it("preflight checks fresh C/D identities and all four empty data categories using reads", async () => {
    const fake = fakeDatabase();
    const stages = [];
    const result = await runPreflight(config(), { ...fake,
      onStage: (progress) => { if (progress.passed) stages.push(progress.stage); } });
    expect(result.ids).toEqual({ C, D });
    expect(fake.calls.filter((entry) => entry.sql.includes("as documents"))).toHaveLength(2);
    expect(fake.calls.filter((entry) => entry.sql.includes("count(*)::integer as objects"))).toHaveLength(2);
    expect(fake.calls.filter((entry) => entry.sql.includes("as uploads"))).toHaveLength(2);
    expect(fake.calls.filter((entry) => entry.sql === "begin isolation level repeatable read read only"))
      .toHaveLength(1);
    expect(fake.calls.filter((entry) => entry.sql === "rollback")).toHaveLength(1);
    expect(fake.calls.every((entry) => /^(select|begin isolation level repeatable read read only|rollback)/iu.test(entry.sql))).toBe(true);
    expect(stages.at(-1)).toBe("PREFLIGHT_COMPLETE");
  });

  it("rejects C/D with any prior Knowledge data without mutating it", async () => {
    const fake = fakeDatabase({ existing: true });
    await expect(runPreflight(config(), fake)).rejects.toThrow("TEST_USER_NOT_EMPTY");
    expect(fake.calls.every((entry) => /^(select|begin isolation level repeatable read read only|rollback)/iu.test(entry.sql))).toBe(true);
  });

  it("accepts integer and decimal-string zero counts, but rejects existing Storage or events", async () => {
    await expect(runPreflight(config(), fakeDatabase({ stringCounts: true }))).resolves.toHaveProperty("ids");
    for (const [options, stage] of [[{ storageExisting: true }, "EMPTY_STORAGE_CHECK_C"],
      [{ eventsExisting: true }, "EMPTY_EVENT_CHECK_C"]]) {
      let diagnosis;
      try { await runPreflight(config(), fakeDatabase(options)); }
      catch (error) { diagnosis = safePreflightDiagnostic(error); }
      expect(diagnosis).toMatchObject({ stage, category: "ASSERTION", code: "TEST_USER_NOT_EMPTY" });
    }
  });

  it.each(["C", "D"])("identifies %s Auth rejection without attempting a database connection", async (account) => {
    const fake = fakeDatabase();
    const createSupabase = () => ({ auth: { getUser: async (jwt) => jwt === `fake-${account.toLowerCase()}-jwt`
      ? { data: null, error: { code: "bad_jwt" } }
      : { data: { user: { id: C } }, error: null } } });
    let diagnosis;
    try { await runPreflight(config(), { ...fake, createSupabase }); }
    catch (error) { diagnosis = safePreflightDiagnostic(error); }
    expect(diagnosis).toMatchObject({ stage: `AUTH_${account}`, category: "AUTH", code: "AUTH_ERROR" });
    expect(fake.calls).toHaveLength(0);
  });

  it("distinguishes a returned Auth network error without exposing its raw message", async () => {
    const fake = fakeDatabase();
    const secret = "sk-test-secret-do-not-leak";
    const createSupabase = () => ({ auth: { getUser: async () => ({ data: null,
      error: { name: "AuthRetryableFetchError", message: secret, cause: { code: "ECONNRESET" } } }) } });
    let diagnosis;
    try { await runPreflight(config(), { ...fake, createSupabase }); }
    catch (error) { diagnosis = safePreflightDiagnostic(error); }
    expect(diagnosis).toMatchObject({ stage: "AUTH_C", category: "NETWORK", code: "ECONNRESET" });
    expect(JSON.stringify(diagnosis)).not.toContain(secret);
  });

  it.each([["postgres", "ADMIN_CONNECTION"],
    ["knowledge_writer_login", "WRITER_CONNECTION_1"]])("identifies %s connection authentication failure", async (role, stage) => {
    const fake = fakeDatabase();
    const createPg = (settings) => {
      if (settings.user.startsWith(`${role}.`)) {
        const error = new Error("fake connection rejection");
        error.code = "28P01";
        throw error;
      }
      return fake.createPg(settings);
    };
    let diagnosis;
    try { await runPreflight(config(), { ...fake, createPg }); }
    catch (error) { diagnosis = safePreflightDiagnostic(error); }
    expect(diagnosis).toMatchObject({ stage, category: "DB_AUTH", code: "28P01" });
  });

  it.each([
    ["admin role query", "ADMIN_ROLE_CHECK", "SQL_PERMISSION", "42501",
      (sql, _values, role) => role === "postgres" && sql.includes("current_user as role_name")],
    ["writer role query", "WRITER_ROLE_CHECK_1", "SQL_PERMISSION", "42501",
      (sql, _values, role) => role === "knowledge_writer_login" && sql.includes("current_user as role_name")],
    ["Storage query", "EMPTY_STORAGE_CHECK_C", "SQL_SCHEMA", "42P01",
      (sql) => sql.includes("count(*)::integer as objects")],
    ["event query", "EMPTY_EVENT_CHECK_C", "SQL_PERMISSION", "42501",
      (sql) => sql.includes("as uploads")],
    ["document query timeout", "EMPTY_DOCUMENT_CHECK_C", "TIMEOUT", "57014",
      (sql) => sql.includes("as documents")],
  ])("reports the exact %s failure stage", async (_label, expectedStage, category, code, match) => {
    const fake = fakeDatabase({ onQuery: (sql, values, role) => {
      if (match(sql, values, role)) {
        const error = new Error("fake database failure");
        error.code = code;
        throw error;
      }
    } });
    let diagnosis;
    try { await runPreflight(config(), fake); }
    catch (error) { diagnosis = safePreflightDiagnostic(error); }
    expect(diagnosis.stage).toBe(expectedStage);
    expect(diagnosis.category).toBe(category);
    expect(diagnosis.code).toBe(code === "57014" ? "REQUEST_TIMEOUT" : code);
    expect(diagnosis.lastPassed).not.toBe(expectedStage);
  });

  it("classifies an unknown failure without exposing raw errors or credentials", async () => {
    const secret = "sk-test-secret-do-not-leak";
    const fake = fakeDatabase({ onQuery: (sql) => {
      if (sql.includes("as documents")) throw new Error(`database response ${secret}`);
    } });
    let diagnosis;
    try { await runPreflight(config(), fake); }
    catch (error) { diagnosis = safePreflightDiagnostic(error); }
    expect(diagnosis).toMatchObject({ stage: "EMPTY_DOCUMENT_CHECK_C",
      lastPassed: "WRITER_PERMISSION_CHECK", category: "UNKNOWN", code: "UNCLASSIFIED_ERROR" });
    expect(JSON.stringify(diagnosis)).not.toContain(secret);
    expect(safePreflightDiagnostic(new AcceptanceError(secret)).code).toBe("ASSERTION_FAILED");
  });

  it("classifies a pg client-side query timeout without a SQLSTATE", async () => {
    const fake = fakeDatabase({ onQuery: (sql) => {
      if (sql.includes("as documents")) throw new Error("Query read timeout");
    } });
    let diagnosis;
    try { await runPreflight(config(), fake); }
    catch (error) { diagnosis = safePreflightDiagnostic(error); }
    expect(diagnosis).toMatchObject({ stage: "EMPTY_DOCUMENT_CHECK_C",
      category: "TIMEOUT", code: "REQUEST_TIMEOUT" });
  });

  it("registers exact fixture identifiers in a durable manifest before writes", async () => {
    const { store, files } = fakeStore();
    const manifest = createRunManifest(RUN, C, D);
    await store.create(manifest);
    manifest.documents.push({ id: DOC, userId: C, path: `${C}/${DOC}/source.txt`, phase: "insert-pending", cleanup: "pending" });
    await store.save(manifest);
    expect((await store.load(RUN)).documents[0].phase).toBe("insert-pending");
    await expect(store.create(manifest)).rejects.toThrow("EXISTS");
    expect([...files.keys()].filter((path) => path.endsWith(".json"))).toHaveLength(1);
    manifest.documents[0].path = `${D}/${DOC}/source.txt`;
    await expect(store.save(manifest)).rejects.toThrow("INVALID_RUN_MANIFEST");
  });

  it("inspect mode uses only registered IDs and paths in a read-only transaction", async () => {
    const { store } = fakeStore();
    const manifest = createRunManifest(RUN, C, D);
    manifest.documents.push({ id: DOC, userId: C, path: `${C}/${DOC}/source.txt`, phase: "inserted", cleanup: "pending" });
    await store.create(manifest);
    const fake = fakeDatabase();
    const result = await inspectFromConfig(config("inspect"), RUN, { store, createPg: fake.createPg });
    expect(result.entries[0]).toMatchObject({ id: DOC, documentStatus: "absent", objectExists: false });
    expect(fake.calls.find((entry) => entry.sql.includes("id=any($1::uuid[])"))?.values).toEqual([[DOC]]);
    expect(fake.calls.every((entry) => /^(select|begin read only|rollback)/iu.test(entry.sql))).toBe(true);
  });

  it("cleanup refuses a mismatched user before any database write", async () => {
    const { store } = fakeStore();
    const manifest = createRunManifest(RUN, C, D);
    const calls = [];
    await expect(cleanupRegistered(manifest, store, {
      projectRef: PROJECT_REF, ids: { C: D, D: C },
      admin: { query: async (sql) => { calls.push(sql); return { rows: [] }; } },
    })).rejects.toThrow("FIXTURE_USER_MISMATCH");
    expect(calls).toEqual([]);
  });

  it("retains event rows and never issues bulk cleanup by user", async () => {
    const { store } = fakeStore();
    const manifest = createRunManifest(RUN, C, D);
    manifest.documents.push({ id: DOC, userId: C, path: `${C}/${DOC}/source.txt`, phase: "insert-pending", cleanup: "pending" });
    await store.create(manifest);
    const fake = fakeDatabase();
    await cleanupRegistered(manifest, store, { projectRef: PROJECT_REF, ids: { C, D },
      admin: fake.createPg({ user: `postgres.${PROJECT_REF}` }),
      first: fake.createPg({ user: `knowledge_writer_login.${PROJECT_REF}` }),
    });
    expect(manifest.eventsRetained).toBe(true);
    expect(manifest.status).toBe("complete");
    expect(fake.calls.some((entry) => /^delete|^update/iu.test(entry.sql))).toBe(false);
    expect(fake.calls.find((entry) => entry.sql.includes("where id=$1::uuid"))?.values).toEqual([DOC]);
  });

  it("rejects an altered fixture owner before cleanup writes", async () => {
    const { store } = fakeStore();
    const manifest = createRunManifest(RUN, C, D);
    manifest.documents.push({ id: DOC, userId: C, path: `${C}/${DOC}/source.txt`, phase: "inserted", cleanup: "pending" });
    await store.create(manifest);
    const fake = fakeDatabase({ onQuery: () => {} });
    const admin = fake.createPg({ user: `postgres.${PROJECT_REF}` });
    const original = admin.query.bind(admin);
    admin.query = async (sql, values) => sql.includes("where id=$1::uuid")
      ? { rows: [{ id: DOC, user_id: D, storage_path: `${D}/${DOC}/source.txt` }] }
      : original(sql, values);
    await expect(cleanupRegistered(manifest, store, { projectRef: PROJECT_REF, ids: { C, D }, admin,
      first: fake.createPg({ user: `knowledge_writer_login.${PROJECT_REF}` }),
    })).rejects.toThrow("FIXTURE_OWNERSHIP_MISMATCH");
    expect(fake.calls.some((entry) => entry.sql.includes("mark_knowledge_deleting"))).toBe(false);
    expect((await store.load(RUN)).documents[0].cleanup).toBe("pending");
  });

  it("keeps the manifest available after an interrupted pending step", async () => {
    const { store } = fakeStore();
    const manifest = createRunManifest(RUN, C, D);
    await store.create(manifest);
    manifest.documents.push({ id: DOC, userId: C, path: `${C}/${DOC}/source.txt`,
      phase: "upload-pending", cleanup: "pending" });
    await store.save(manifest);
    manifest.status = "needs-inspection";
    await store.save(manifest);
    expect((await store.load(RUN))).toMatchObject({ status: "needs-inspection",
      documents: [{ id: DOC, phase: "upload-pending", cleanup: "pending" }] });
  });

  it("stops before writes on interrupt while retaining the registered fixture", async () => {
    const { store } = fakeStore();
    const manifest = createRunManifest(RUN, C, D);
    await store.create(manifest);
    const c = { from: () => { throw new Error("unexpected write"); } };
    await expect(executeScenario({ ids: { C, D }, c }, manifest, store, () => true))
      .rejects.toThrow("INTERRUPTED_NEEDS_INSPECTION");
    expect((await store.load(RUN)).documents).toMatchObject([{ phase: "insert-pending", cleanup: "pending" }]);
  });

  it("does not retry an uncertain insert and preserves the exact pending ID", async () => {
    const { store } = fakeStore();
    const manifest = createRunManifest(RUN, C, D);
    await store.create(manifest);
    let attempts = 0;
    const c = { from: () => ({ insert: () => ({ select: () => ({ single: async () => {
      attempts += 1;
      throw new Error("simulated timeout");
    } }) }) }) };
    await expect(executeScenario({ ids: { C, D }, c }, manifest, store)).rejects.toThrow("simulated timeout");
    expect(attempts).toBe(1);
    expect((await store.load(RUN)).documents).toMatchObject([{ phase: "insert-pending", cleanup: "pending" }]);
  });
});
