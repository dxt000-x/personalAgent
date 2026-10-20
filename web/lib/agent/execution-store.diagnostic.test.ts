import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connect: vi.fn(), query: vi.fn(), release: vi.fn(), poolQuery: vi.fn(),
  poolCount: 0, certFails: false, certCount: 0,
  onCert: undefined as (() => void) | undefined,
  poolOptions: undefined as { user: string; host: string; ssl: { rejectUnauthorized: boolean; servername: string } } | undefined,
}));
vi.mock("pg", () => ({ Pool: class {
  constructor(options: NonNullable<typeof state.poolOptions>) { state.poolCount += 1; state.poolOptions = options; }
  on() { return this; }
  connect() { return state.connect(); }
  query(...args: unknown[]) { return state.poolQuery(...args); }
} }));
vi.mock("node:crypto", () => ({ X509Certificate: class {
  constructor() {
    state.certCount += 1;
    state.onCert?.();
    if (state.certFails) throw new Error("private certificate detail");
  }
} }));

const ref = "pxfaqcepztzqyqtmbdrf";
const goodUrl = `postgresql://agent_execution_writer_login.${ref}:test-only@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require`;
const pass = { publicRefExpected: "pass", writerRefExpected: "pass", poolerConfig: "pass",
  caConfig: "pass", connection: "pass", tlsVerification: "pass", databaseName: "pass",
  projectIdentity: "inferred_from_pooler_routing" };

async function probe() {
  return (await import("./execution-store")).diagnoseExecutionDatabase();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.poolCount = 0;
  state.certFails = false;
  state.certCount = 0;
  state.onCert = undefined;
  state.poolOptions = undefined;
  vi.stubEnv("AGENT_DB_URL", goodUrl);
  vi.stubEnv("AGENT_DB_CA_CERT_BASE64", Buffer.from("test-certificate-only").toString("base64"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${ref}.supabase.co`);
  state.query.mockResolvedValue({ rows: [{ name: "postgres" }] });
  state.connect.mockResolvedValue({ query: state.query, release: state.release });
});
afterEach(() => vi.unstubAllEnvs());

describe("execution database read-only diagnostic", () => {
  it.each(["AGENT_DB_URL", "AGENT_DB_CA_CERT_BASE64", "NEXT_PUBLIC_SUPABASE_URL"])(
    "fails closed without %s before creating a pool or issuing SQL", async (name) => {
      vi.stubEnv(name, undefined);
      expect(await probe()).toEqual({
        publicRefExpected: "not_checked", writerRefExpected: "not_checked",
        poolerConfig: "not_checked", caConfig: "not_checked",
        connection: "not_checked", tlsVerification: "not_checked",
        databaseName: "not_checked", projectIdentity: "not_verified",
      });
      expect(state.poolCount).toBe(0);
      expect(state.connect).not.toHaveBeenCalled();
      expect(state.query).not.toHaveBeenCalled();
      expect(state.poolQuery).not.toHaveBeenCalled();
      expect(state.release).not.toHaveBeenCalled();
    },
  );

  it("reuses a strict TLS pool, issues only the read-only probe, and releases the client", async () => {
    expect(await probe()).toEqual(pass);
    expect(state.poolOptions).toMatchObject({ user: `agent_execution_writer_login.${ref}`,
      ssl: { rejectUnauthorized: true, servername: state.poolOptions?.host } });
    expect(state.query).toHaveBeenCalledExactlyOnceWith("SELECT current_database() AS name");
    expect(state.release).toHaveBeenCalledTimes(1);
  });

  it("does not infer the target from two matching but wrong project refs", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://otherproject.supabase.co");
    vi.stubEnv("AGENT_DB_URL", goodUrl.replaceAll(ref, "otherproject"));
    const result = await probe();
    expect(result.publicRefExpected).toBe("fail");
    expect(result.writerRefExpected).toBe("fail");
    expect(result.projectIdentity).toBe("not_verified");
    expect(state.connect).not.toHaveBeenCalled();
  });

  it("rejects a Writer ref different from the target", async () => {
    vi.stubEnv("AGENT_DB_URL", goodUrl.replace(ref, "otherproject"));
    expect((await probe()).writerRefExpected).toBe("fail");
    expect(state.connect).not.toHaveBeenCalled();
  });

  it.each(["host", "port", "database"])("rejects invalid %s", async (part) => {
    vi.stubEnv("AGENT_DB_URL", part === "host" ? goodUrl.replace("pooler.supabase.com", "example.com")
      : part === "port" ? goodUrl.replace(":6543", ":5432")
        : goodUrl.replace("/postgres?", "/other?"));
    expect((await probe()).poolerConfig).toBe("fail");
    expect(state.connect).not.toHaveBeenCalled();
  });

  it("rejects an invalid CA without exposing errors", async () => {
    state.certFails = true;
    const result = await probe();
    expect(result.caConfig).toBe("fail");
    expect(JSON.stringify(result)).not.toContain("private certificate detail");
    expect(state.connect).not.toHaveBeenCalled();
  });

  it("reports connection and query failures without exposing errors", async () => {
    state.connect.mockRejectedValueOnce(new Error("private connection detail"));
    const disconnected = await probe();
    expect(disconnected).toMatchObject({ connection: "fail", tlsVerification: "not_checked",
      databaseName: "not_checked", projectIdentity: "not_verified" });
    state.query.mockRejectedValueOnce(new Error("private query detail"));
    const queryFailed = await probe();
    expect(queryFailed).toMatchObject({ connection: "pass", databaseName: "fail",
      projectIdentity: "not_verified" });
    expect(state.release).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([disconnected, queryFailed])).not.toMatch(/private|test-only/u);
  });

  it("does not claim project identity from a different database name", async () => {
    state.query.mockResolvedValueOnce({ rows: [{ name: "other" }] });
    expect(await probe()).toMatchObject({ databaseName: "fail", projectIdentity: "not_verified" });
    expect(state.release).toHaveBeenCalledTimes(1);
  });

  it("reports the reused pool's creation-time configuration after environment changes", async () => {
    expect(await probe()).toEqual(pass);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://otherproject.supabase.co");
    vi.stubEnv("AGENT_DB_URL", goodUrl.replaceAll(ref, "otherproject"));
    expect(await probe()).toEqual(pass);
    expect(state.poolCount).toBe(1);
    expect(state.release).toHaveBeenCalledTimes(2);
  });

  it("describes the pool previously created by the authorization path", async () => {
    state.poolQuery.mockResolvedValueOnce({ rows: [{ value: true }] });
    const store = await import("./execution-store");
    await store.persistExecutionAuthorization("11111111-1111-4111-8111-111111111111", {
      jti: "22222222-2222-4222-8222-222222222222", planHash: "a".repeat(64),
      expiresAt: Date.now() + 20_000,
    });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://otherproject.supabase.co");
    vi.stubEnv("AGENT_DB_URL", goodUrl.replaceAll(ref, "otherproject"));
    expect(await store.diagnoseExecutionDatabase()).toEqual(pass);
    expect(state.poolCount).toBe(1);
    expect(state.query).toHaveBeenCalledExactlyOnceWith("SELECT current_database() AS name");
    expect(state.release).toHaveBeenCalledTimes(1);
  });

  it("creates the pool from configuration A even if environment changes during validation", async () => {
    state.onCert = () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://otherproject.supabase.co");
      vi.stubEnv("AGENT_DB_URL", goodUrl.replaceAll(ref, "otherproject"));
      state.onCert = undefined;
    };
    expect(await probe()).toEqual(pass);
    expect(state.poolOptions?.user).toBe(`agent_execution_writer_login.${ref}`);
    expect(state.certCount).toBe(1);
    expect(state.poolCount).toBe(1);
  });
});
