import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as confirm } from "../confirm/route";
import { POST as execute } from "./route";
import { issuePlanAuthorization } from "@/lib/agent/execution-authorization";
import { createClient } from "@/lib/supabase/server";
import { createHmac } from "node:crypto";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const plan = { version: 1 as const, goal: "读取当前时间", steps: [{
  id: "step-1", title: "读取时间", description: "读取当前 UTC 时间。", status: "pending" as const,
}], requiresConfirmation: true as const };

function request(path: "confirm" | "execute", body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000/api/agent/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}

function authenticated(userId = "user-a") {
  vi.mocked(createClient).mockResolvedValue({ auth: { getClaims: vi.fn().mockResolvedValue({
    data: { claims: { sub: userId } }, error: null,
  }) } } as unknown as NonNullable<Awaited<ReturnType<typeof createClient>>>);
}

function signedNonAllowlistedTool(tool: string): string {
  const payload = Buffer.from(JSON.stringify({ version: 1, userId: "user-a", tool, phase: "confirmed",
    planHash: "0".repeat(64), expiresAt: Date.now() + 20_000, nonce: "test-nonce-for-signature" })).toString("base64url");
  const signature = createHmac("sha256", process.env.AGENT_EXECUTION_SECRET!).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

beforeEach(() => {
  process.env.AGENT_EXECUTION_SECRET = "local-test-only-key-with-more-than-thirty-two-characters";
  authenticated();
});
afterEach(() => {
  delete process.env.AGENT_EXECUTION_SECRET;
  vi.clearAllMocks();
});

describe("authenticated Agent execution", () => {
  it("rejects unauthenticated confirmation and execution", async () => {
    vi.mocked(createClient).mockResolvedValue(null);
    const planAuthorization = issuePlanAuthorization("user-a", plan);
    expect((await confirm(request("confirm", { planAuthorization, plan }))).status).toBe(401);
    expect((await execute(request("execute", { authorization: planAuthorization }))).status).toBe(401);
  });

  it("rejects execution before confirmation and invalid tokens", async () => {
    const planAuthorization = issuePlanAuthorization("user-a", plan);
    const unconfirmed = await execute(request("execute", { authorization: planAuthorization }));
    expect(unconfirmed.status).toBe(400);
    expect((await unconfirmed.json()).error.code).toBe("INVALID_REQUEST");
    expect((await execute(request("execute", { authorization: "invalid" }))).status).toBe(400);
    expect((await execute(request("execute", { authorization: "invalid" }))).status).toBe(400);
  });

  it("executes only fixed read_current_time after server confirmation", async () => {
    const planAuthorization = issuePlanAuthorization("user-a", plan);
    const confirmed = await confirm(request("confirm", { planAuthorization, plan }));
    expect(confirmed.status).toBe(200);
    const { authorization } = await confirmed.json();
    const result = await execute(request("execute", { authorization }));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.result).toMatchObject({ tool: "read_current_time", ok: true, data: { iso: expect.any(String) } });
    expect(new Date(body.result.data.iso).toISOString()).toBe(body.result.data.iso);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("binds tokens to the authenticated user", async () => {
    const token = issuePlanAuthorization("user-a", plan);
    authenticated("user-b");
    expect((await confirm(request("confirm", { planAuthorization: token, plan }))).status).toBe(400);
  });

  it("rejects a changed plan even with the original signed plan token", async () => {
    const token = issuePlanAuthorization("user-a", plan);
    const changedPlan = { ...plan, goal: "另一个任务" };
    const response = await confirm(request("confirm", { planAuthorization: token, plan: changedPlan }));
    expect(response.status).toBe(400);
  });

  it("rejects tampered and expired plan authorizations", async () => {
    const token = issuePlanAuthorization("user-a", plan);
    expect(token).toBeTruthy();
    expect((await confirm(request("confirm", { planAuthorization: `${token}x`, plan }))).status).toBe(400);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 6 * 60 * 1000);
    try {
      expect((await confirm(request("confirm", { planAuthorization: token, plan }))).status).toBe(400);
    } finally {
      clock.mockRestore();
    }
  });

  it("fails closed without a signing key", async () => {
    const token = issuePlanAuthorization("user-a", plan);
    delete process.env.AGENT_EXECUTION_SECRET;
    expect((await confirm(request("confirm", { planAuthorization: token, plan }))).status).toBe(400);
    expect((await execute(request("execute", { authorization: token }))).status).toBe(400);
  });

  it.each(["read_app_status", "unknown_tool"])("rejects even signed non-allowlisted tool %s", async (tool) => {
    const response = await execute(request("execute", { authorization: signedNonAllowlistedTool(tool) }));
    expect(response.status).toBe(400);
  });

  it.each([
    { authorization: "token", tool: "read_app_status" },
    { authorization: "token", tool: "unknown" },
    { authorization: "token", input: { command: "echo x" } },
    { authorization: "token", handler: "custom" },
    { authorization: "token", module: "node:fs" },
    { authorization: "token", function: "run" },
    { authorization: "token", command: "whoami" },
    { authorization: "token", url: "https://example.invalid" },
  ])("rejects client-selected execution fields %#", async (body) => {
    const response = await execute(request("execute", body));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("rejects malformed confirmation and mismatched Origin", async () => {
    expect((await confirm(request("confirm", { confirmed: true }))).status).toBe(400);
    expect((await execute(request("execute", { authorization: "x" }, { Origin: "https://other.invalid" }))).status).toBe(400);
  });
});
