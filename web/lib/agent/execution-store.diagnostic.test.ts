import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connect: vi.fn(), query: vi.fn(), release: vi.fn(), poolCount: 0,
  certFails: false, certCount: 0, onCert: undefined as (() => void) | undefined,
  poolOptions: undefined as { user: string; host: string } | undefined,
}));
vi.mock("pg", () => ({ Pool: class {
  constructor(options: { user: string; host: string }) { state.poolCount += 1; state.poolOptions = options; }
  on() { return this; }
  connect() { return state.connect(); }
} }));
vi.mock("node:crypto", () => ({ X509Certificate: class {
  constructor() {
    state.certCount += 1;
    state.onCert?.();
    if (state.certFails) throw new Error("private CA detail");
  }
} }));

const ref = "pxfaqcepztzqyqtmbdrf";
const goodUrl = `postgresql://agent_execution_writer_login.${ref}:test-only@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require`;
const keys = ["AGENT_DB_URL", "AGENT_DB_CA_CERT_BASE64", "NEXT_PUBLIC_SUPABASE_URL"] as const;

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
  process.env.AGENT_DB_URL = goodUrl;
  process.env.AGENT_DB_CA_CERT_BASE64 = Buffer.from("test-cert-only").toString("base64");
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`;
  state.query.mockResolvedValue({ rows: [{ name: "postgres" }] });
  state.connect.mockResolvedValue({ query: state.query, release: state.release });
});
afterEach(() => { for (const key of keys) delete process.env[key]; });

describe("execution database diagnostic", () => {
  it("uses one read-only query, releases the client and reports only fixed states", async () => {
    const result = await probe();
    expect(result).toEqual({ publicRefExpected: "pass", writerRefMatchesPublic: "pass",
      poolerConfig: "pass", caConfig: "pass", connection: "pass",
      tlsVerification: "pass", databaseName: "pass",
      projectIdentity: "inferred_from_pooler_routing" });
    expect(state.query).toHaveBeenCalledExactlyOnceWith("SELECT current_database() AS name");
    expect(state.release).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("test-only");
  });

  it("does not infer identity from a different public project", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://otherproject.supabase.co";
    process.env.AGENT_DB_URL = goodUrl.replace(ref, "otherproject");
    expect((await probe()).publicRefExpected).toBe("fail");
    expect(state.connect).not.toHaveBeenCalled();
  });

  it("rejects a Writer ref that differs from the public ref", async () => {
    process.env.AGENT_DB_URL = goodUrl.replace(ref, "otherproject");
    expect((await probe()).writerRefMatchesPublic).toBe("fail");
    expect(state.connect).not.toHaveBeenCalled();
  });

  it.each(["host", "port", "database"])("rejects invalid %s", async (part) => {
    process.env.AGENT_DB_URL = part === "host" ? goodUrl.replace("pooler.supabase.com", "example.com")
      : part === "port" ? goodUrl.replace(":6543", ":5432")
        : goodUrl.replace("/postgres?", "/other?");
    expect((await probe()).poolerConfig).toBe("fail");
    expect(state.connect).not.toHaveBeenCalled();
  });

  it("rejects an invalid CA without exposing it", async () => {
    state.certFails = true;
    const result = await probe();
    expect(result.caConfig).toBe("fail");
    expect(JSON.stringify(result)).not.toContain("private CA detail");
    expect(state.connect).not.toHaveBeenCalled();
  });

  it("reports connection and query failures separately and releases acquired clients", async () => {
    state.connect.mockRejectedValueOnce(new Error("private connection detail"));
    const disconnected = await probe();
    expect(disconnected.connection).toBe("fail");
    expect(disconnected.tlsVerification).toBe("not_checked");
    expect(disconnected.databaseName).toBe("not_checked");
    expect(disconnected.projectIdentity).toBe("not_verified");
    expect(state.release).not.toHaveBeenCalled();
    state.query.mockRejectedValueOnce(new Error("private query detail"));
    const queryFailed = await probe();
    expect(queryFailed.connection).toBe("pass");
    expect(queryFailed.databaseName).toBe("fail");
    expect(state.release).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(queryFailed)).not.toContain("private query detail");
  });

  it("does not treat a different database name as target identity", async () => {
    state.query.mockResolvedValueOnce({ rows: [{ name: "other" }] });
    const result = await probe();
    expect(result.databaseName).toBe("fail");
    expect(result.projectIdentity).toBe("not_verified");
    expect(state.release).toHaveBeenCalledTimes(1);
  });

  it("reports the configuration captured by the reused pool after environment changes", async () => {
    expect((await probe()).connection).toBe("pass");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://otherproject.supabase.co";
    process.env.AGENT_DB_URL = goodUrl.replace(ref, "otherproject");
    const result = await probe();
    expect(result.publicRefExpected).toBe("pass");
    expect(state.poolCount).toBe(1);
    expect(state.release).toHaveBeenCalledTimes(2);
  });

  it("uses configuration A once even when the environment changes to B during first validation", async () => {
    state.onCert = () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://otherproject.supabase.co";
      process.env.AGENT_DB_URL = goodUrl.replace(ref, "otherproject");
      state.onCert = undefined;
    };
    const first = await probe();
    expect(state.certCount).toBe(1);
    expect(state.poolCount).toBe(1);
    expect(state.poolOptions?.user).toBe(`agent_execution_writer_login.${ref}`);
    expect(first.publicRefExpected).toBe("pass");
    expect(first.projectIdentity).toBe("inferred_from_pooler_routing");
    const second = await probe();
    expect(second.publicRefExpected).toBe("pass");
    expect(state.certCount).toBe(1);
    expect(state.poolCount).toBe(1);
    expect(state.release).toHaveBeenCalledTimes(2);
  });
});
