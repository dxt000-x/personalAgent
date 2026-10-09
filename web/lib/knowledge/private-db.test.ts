import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
const makePool = vi.hoisted(() => vi.fn());
vi.mock("pg", () => ({ Pool: class MockPool {
  constructor(options: unknown) { makePool(options); }
  query = query;
} }));

beforeEach(() => {
  vi.resetModules();
  query.mockReset();
  makePool.mockClear();
  delete process.env.KNOWLEDGE_DB_URL;
});
afterEach(() => { delete process.env.KNOWLEDGE_DB_URL; });

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
    process.env.KNOWLEDGE_DB_URL = "postgresql://knowledge_writer_login:fake@db.invalid/postgres";
    query.mockResolvedValue({ rows: [{ value: true }] });
    const { callKnowledgeTransition } = await import("./private-db");
    expect(await callKnowledgeTransition("complete", ["user-a", "doc-a", 2, '["safe"]'])).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("knowledge_private.complete_knowledge_document($1::uuid, $2::uuid"),
      ["user-a", "doc-a", 2, '["safe"]'],
    );
    expect(makePool).toHaveBeenCalledWith(expect.objectContaining({
      user: "knowledge_writer_login", ssl: { rejectUnauthorized: true },
    }));
  });
  it("maps database failures to a safe error", async () => {
    process.env.KNOWLEDGE_DB_URL = "postgresql://knowledge_writer_login:fake@db.invalid/postgres";
    query.mockRejectedValue(new Error("password=sk-test-secret-do-not-leak"));
    const { callKnowledgeTransition } = await import("./private-db");
    let message = "";
    try { await callKnowledgeTransition("claim", ["user-a", "doc-a"]); }
    catch (error) { message = String(error); }
    expect(message).not.toContain("sk-test-secret-do-not-leak");
    expect(message).toContain("知识库服务暂时不可用");
  });
  it("rejects upload initialization if the writer lacks the private completion grant", async () => {
    process.env.KNOWLEDGE_DB_URL = "postgresql://knowledge_writer_login:fake@db.invalid/postgres";
    query.mockResolvedValue({ rows: [{ value: false }] });
    const { assertKnowledgeWriterReady } = await import("./private-db");
    await expect(assertKnowledgeWriterReady()).rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE" });
  });
});
