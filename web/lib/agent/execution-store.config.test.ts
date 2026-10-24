import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";

const state = vi.hoisted(() => ({
  poolCount: 0,
  poolOptions: undefined as { user: string; host: string; ssl: { rejectUnauthorized: boolean; servername: string } } | undefined,
  query: vi.fn(),
  connectError: false,
  releaseError: false,
  releaseCount: 0,
  certificateFails: false,
  onCertificate: undefined as (() => void) | undefined,
}));

vi.mock("pg", () => ({ Pool: class {
  constructor(options: NonNullable<typeof state.poolOptions>) { state.poolCount += 1; state.poolOptions = options; }
  on() { return this; }
  query(...args: unknown[]) { return state.query(...args); }
  async connect() {
    if (state.connectError) throw new Error("private connection detail");
    return { query: (...args: unknown[]) => state.query(...args), release: () => {
      state.releaseCount += 1;
      if (state.releaseError) throw new Error("private release detail");
    } };
  }
} }));
vi.mock("node:crypto", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:crypto")>()),
  X509Certificate: class {
    constructor() {
      state.onCertificate?.();
      if (state.certificateFails) throw new Error("private certificate detail");
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const testRef = "pxfaqcepztzqyqtmbdrf";
const otherRef = "abcdefghijklmnopqrst";
const databaseUrl = (ref: string) =>
  `postgresql://agent_execution_writer_login.${ref}:test-only@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require`;
const plan = { version: 1 as const, goal: "读取当前时间", steps: [{
  id: "step-1", title: "读取时间", description: "读取当前 UTC 时间。", status: "pending" as const,
}], requiresConfirmation: true as const };

async function confirmPlan() {
  const { issuePlanAuthorization } = await import("./execution-authorization");
  const { POST } = await import("../../app/api/agent/confirm/route");
  return POST(new Request("http://localhost:3000/api/agent/confirm", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, planAuthorization: issuePlanAuthorization("11111111-1111-4111-8111-111111111111", plan) }),
  }));
}

async function expectRejectedWithoutDatabaseAccess() {
  const response = await confirmPlan();
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.error.code).toBe("EXECUTION_UNAVAILABLE");
  expect(JSON.stringify(body)).not.toMatch(/test-only|pooler|postgresql|certificate|agent_execution_writer_login|pxfaqcepztzqyqtmbdrf/u);
  expect(state.poolCount).toBe(0);
  expect(state.query).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.poolCount = 0;
  state.poolOptions = undefined;
  state.certificateFails = false;
  state.connectError = false;
  state.releaseError = false;
  state.releaseCount = 0;
  state.onCertificate = undefined;
  vi.mocked(createClient).mockResolvedValue({ auth: { getClaims: vi.fn().mockResolvedValue({
    data: { claims: { sub: "11111111-1111-4111-8111-111111111111" } }, error: null,
  }) } } as unknown as NonNullable<Awaited<ReturnType<typeof createClient>>>);
  vi.stubEnv("AGENT_EXECUTION_SECRET", "local-test-only-key-with-more-than-thirty-two-characters");
  vi.stubEnv("AGENT_EXECUTION_EXPECTED_PROJECT_REF", testRef);
  vi.stubEnv("AGENT_DB_URL", databaseUrl(testRef));
  vi.stubEnv("AGENT_DB_CA_CERT_BASE64", Buffer.from("test-certificate-only").toString("base64"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${testRef}.supabase.co`);
  state.query.mockResolvedValue({ rows: [{ value: true }] });
});
afterEach(() => vi.unstubAllEnvs());

describe("execution store project configuration", () => {
  it.each([undefined, "", "wrong", "UPPERCASEPROJECT1234", "otherproject.test", " otherproject12345678 "])(
    "rejects missing or malformed expected Ref %s before creating a pool", async (ref) => {
      vi.stubEnv("AGENT_EXECUTION_EXPECTED_PROJECT_REF", ref);
      await expectRejectedWithoutDatabaseAccess();
    },
  );

  it("rejects two matching project Refs when the independent expected Ref differs", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${otherRef}.supabase.co`);
    vi.stubEnv("AGENT_DB_URL", databaseUrl(otherRef));
    await expectRejectedWithoutDatabaseAccess();
  });

  it("rejects a public URL Ref that differs from the expected Ref", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${otherRef}.supabase.co`);
    await expectRejectedWithoutDatabaseAccess();
  });

  it("rejects a Writer username that differs from the expected Ref", async () => {
    vi.stubEnv("AGENT_DB_URL", databaseUrl(otherRef));
    await expectRejectedWithoutDatabaseAccess();
  });

  it.each(["AGENT_DB_URL", "AGENT_DB_CA_CERT_BASE64", "NEXT_PUBLIC_SUPABASE_URL"])(
    "rejects missing %s", async (name) => {
      vi.stubEnv(name, undefined);
      await expectRejectedWithoutDatabaseAccess();
    },
  );

  it.each(["host", "port", "database", "password"])("rejects invalid Pooler %s", async (part) => {
    const url = databaseUrl(testRef);
    vi.stubEnv("AGENT_DB_URL", part === "host" ? url.replace("pooler.supabase.com", "example.com")
      : part === "port" ? url.replace(":6543", ":5432")
        : part === "database" ? url.replace("/postgres?", "/other?")
          : url.replace(":test-only@", ":@"));
    await expectRejectedWithoutDatabaseAccess();
  });

  it("rejects an invalid CA without exposing database details", async () => {
    state.certificateFails = true;
    await expectRejectedWithoutDatabaseAccess();
  });

  it.each([testRef, otherRef])("accepts a configured project %s with strict TLS", async (ref) => {
    vi.stubEnv("AGENT_EXECUTION_EXPECTED_PROJECT_REF", ref);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${ref}.supabase.co`);
    vi.stubEnv("AGENT_DB_URL", databaseUrl(ref));
    const response = await confirmPlan();
    expect(response.status).toBe(200);
    expect(state.poolCount).toBe(1);
    expect(state.query).toHaveBeenCalledTimes(1);
    expect(state.poolOptions).toMatchObject({ user: `agent_execution_writer_login.${ref}`,
      ssl: { rejectUnauthorized: true, servername: state.poolOptions?.host } });
  });

  it("uses one validated configuration when the environment changes during first pool creation", async () => {
    state.onCertificate = () => {
      vi.stubEnv("AGENT_EXECUTION_EXPECTED_PROJECT_REF", otherRef);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${otherRef}.supabase.co`);
      vi.stubEnv("AGENT_DB_URL", databaseUrl(otherRef));
      state.onCertificate = undefined;
    };
    expect((await confirmPlan()).status).toBe(200);
    expect(state.poolOptions?.user).toBe(`agent_execution_writer_login.${testRef}`);
    expect((await confirmPlan()).status).toBe(200);
    expect(state.poolCount).toBe(1);
  });

  it("returns only a redacted error when the database query fails", async () => {
    state.query.mockRejectedValueOnce(new Error("private database password"));
    const response = await confirmPlan();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/private|database password|test-only/u);
    expect(state.releaseCount).toBe(1);
  });

  it.each([
    ["config", "invalid_config", "config"],
    ["pool_connect", "connection_or_tls", "connect"],
    ["issue_query", "query_error", "query"],
    ["issue_result", "returned_false", "false"],
    ["issue_result", "unexpected_result", "empty"],
  ] as const)("logs one safe %s failure", async (stage, category, failure) => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    if (failure === "config") vi.stubEnv("AGENT_EXECUTION_EXPECTED_PROJECT_REF", undefined);
    if (failure === "connect") state.connectError = true;
    if (failure === "query") state.query.mockRejectedValueOnce(new Error("private password and SQL parameters"));
    if (failure === "false") state.query.mockResolvedValueOnce({ rows: [{ value: false }] });
    if (failure === "empty") state.query.mockResolvedValueOnce({ rows: [] });
    const response = await confirmPlan();
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("EXECUTION_UNAVAILABLE");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: "agent_confirm_failure", stage, category });
    expect(String(log.mock.calls[0][0])).not.toMatch(/private|password|postgres|certificate|11111111|pxfaqcepztzqyqtmbdrf/u);
    expect(state.releaseCount).toBe(failure === "query" || failure === "false" || failure === "empty" ? 1 : 0);
    log.mockRestore();
  });

  it("classifies a signing failure without database access", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const authorization = await import("./execution-authorization");
    const issue = vi.spyOn(authorization, "issueExecutionAuthorization").mockReturnValueOnce(null);
    const response = await confirmPlan();
    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      event: "agent_confirm_failure", stage: "signing", category: "invalid_config",
    });
    expect(state.poolCount).toBe(0);
    issue.mockRestore();
    log.mockRestore();
  });

  it("classifies an unexpected error without logging its contents", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    state.releaseError = true;
    const response = await confirmPlan();
    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      event: "agent_confirm_failure", stage: "unexpected", category: "unexpected",
    });
    expect(String(log.mock.calls[0][0])).not.toContain("private release detail");
    log.mockRestore();
  });
});
