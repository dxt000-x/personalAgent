import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolerUrl = "postgresql://knowledge_writer_login.testref:fake@aws-0-test.pooler.supabase.com:6543/postgres";
const fakeCa = Buffer.from("-----BEGIN CERTIFICATE-----\nfake-test-certificate\n-----END CERTIFICATE-----").toString("base64");

const query = vi.hoisted(() => vi.fn());
const connect = vi.hoisted(() => vi.fn());
const release = vi.hoisted(() => vi.fn());
const makePool = vi.hoisted(() => vi.fn());
vi.mock("pg", () => ({ Pool: class MockPool {
  constructor(options: unknown) { makePool(options); }
  query = query;
  connect = connect;
  on = vi.fn();
} }));

beforeEach(() => {
  vi.resetModules();
  query.mockReset();
  connect.mockReset();
  release.mockReset();
  connect.mockImplementation(async () => ({ query, release }));
  makePool.mockClear();
  delete process.env.KNOWLEDGE_DB_URL;
  process.env.KNOWLEDGE_DB_CA_CERT_BASE64 = fakeCa;
});
afterEach(() => { delete process.env.KNOWLEDGE_DB_URL; delete process.env.KNOWLEDGE_DB_CA_CERT_BASE64; });

describe("server-only Knowledge transition connection", () => {
  it("fails closed without a dedicated database role", async () => {
    const { callKnowledgeTransition } = await import("./private-db");
    await expect(callKnowledgeTransition("complete", ["user", "doc", 1, "[]"]))
      .rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE" });
    expect(makePool).not.toHaveBeenCalled();
  });
  it("rejects an accidental privileged postgres connection string", async () => {
    process.env.KNOWLEDGE_DB_URL = "postgresql://postgres:fake@db.invalid/postgres";
    const { callKnowledgeTransition } = await import("./private-db");
    await expect(callKnowledgeTransition("complete", ["user", "doc", 1, "[]"]))
      .rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE" });
    expect(makePool).not.toHaveBeenCalled();
  });
  it("calls only fixed private SQL with the server supplied identity and generation", async () => {
    process.env.KNOWLEDGE_DB_URL = poolerUrl;
    query.mockResolvedValue({ rows: [{ value: true }] });
    const { callKnowledgeTransition } = await import("./private-db");
    expect(await callKnowledgeTransition("complete", ["user-a", "doc-a", 2, '["safe"]'])).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("knowledge_private.complete_knowledge_document($1::uuid, $2::uuid"),
      ["user-a", "doc-a", 2, '["safe"]'],
    );
    expect(makePool).toHaveBeenCalledWith(expect.objectContaining({
      user: "knowledge_writer_login.testref", port: 6543, max: 2,
      connectionTimeoutMillis: 5000, query_timeout: 10000,
      ssl: { ca: expect.stringContaining("BEGIN CERTIFICATE"),
        servername: "aws-0-test.pooler.supabase.com", rejectUnauthorized: true },
    }));
  });
  it("maps database failures to a safe error", async () => {
    process.env.KNOWLEDGE_DB_URL = poolerUrl;
    query.mockRejectedValue(new Error("password=sk-test-secret-do-not-leak"));
    const { callKnowledgeTransition } = await import("./private-db");
    let message = "";
    try { await callKnowledgeTransition("claim", ["user-a", "doc-a"]); }
    catch (error) { message = String(error); }
    expect(message).not.toContain("sk-test-secret-do-not-leak");
    expect(message).toContain("知识库服务暂时不可用");
  });
  it("rejects upload initialization if the writer lacks the private completion grant", async () => {
    process.env.KNOWLEDGE_DB_URL = poolerUrl;
    query.mockResolvedValue({ rows: [{ value: false }] });
    const { assertKnowledgeWriterReady } = await import("./private-db");
    await expect(assertKnowledgeWriterReady()).rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE" });
    expect(release).toHaveBeenCalledOnce();
  });
  it("does not log configuration, connection, privilege or success details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const missing = await import("./private-db");
      await expect(missing.assertKnowledgeWriterReady()).rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE" });
      expect(log).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      vi.resetModules();
      log.mockClear();
      process.env.KNOWLEDGE_DB_URL = poolerUrl;
      connect.mockRejectedValueOnce(Object.assign(
        new Error("password authentication failed for user; password=secret-never-log"),
        { name: "DatabaseError", code: "28P01" },
      ));
      const connected = await import("./private-db");
      await expect(connected.assertKnowledgeWriterReady()).rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE" });
      expect(log).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      connect.mockImplementation(async () => ({ query, release }));
      query.mockResolvedValueOnce({ rows: [{ value: false }] });
      await expect(connected.assertKnowledgeWriterReady()).rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE" });
      expect(log).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      query.mockResolvedValueOnce({ rows: [{ value: true }] });
      await expect(connected.assertKnowledgeWriterReady()).resolves.toBeUndefined();
      expect(log).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    } finally { log.mockRestore(); info.mockRestore(); }
  });
  it("does not log TLS failure details", async () => {
    process.env.KNOWLEDGE_DB_URL = poolerUrl;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const hostile = Object.assign(new Error(`self-signed certificate; ${poolerUrl}; ${fakeCa}`), {
        name: "secret-name", code: "secret-code", detail: "secret-detail",
      });
      connect.mockRejectedValueOnce(hostile);
      const { assertKnowledgeWriterReady } = await import("./private-db");
      await expect(assertKnowledgeWriterReady()).rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE" });
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it("rejects session-pooler ports and missing CA verification", async () => {
    process.env.KNOWLEDGE_DB_URL = poolerUrl.replace(":6543/", ":5432/");
    const { callKnowledgeTransition } = await import("./private-db");
    await expect(callKnowledgeTransition("claim", ["user", "doc"])).rejects.toMatchObject({
      code: "KNOWLEDGE_UNAVAILABLE",
    });
    expect(makePool).not.toHaveBeenCalled();
    vi.resetModules();
    process.env.KNOWLEDGE_DB_URL = poolerUrl;
    delete process.env.KNOWLEDGE_DB_CA_CERT_BASE64;
    const reloaded = await import("./private-db");
    await expect(reloaded.callKnowledgeTransition("claim", ["user", "doc"])).rejects.toMatchObject({
      code: "KNOWLEDGE_UNAVAILABLE",
    });
    expect(makePool).not.toHaveBeenCalled();
  });
});
