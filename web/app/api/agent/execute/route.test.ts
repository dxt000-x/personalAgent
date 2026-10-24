import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as confirm } from "../confirm/route";
import { POST as execute } from "./route";
import { issuePlanAuthorization } from "@/lib/agent/execution-authorization";
import { createClient } from "@/lib/supabase/server";
import { createHmac } from "node:crypto";
import { persistExecutionAuthorization, consumeExecutionAuthorization, finishExecutionAuthorization } from "@/lib/agent/execution-store";
import { executeRegisteredTool } from "@/lib/agent/tool-executor";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/agent/execution-store", () => ({
  persistExecutionAuthorization: vi.fn(), consumeExecutionAuthorization: vi.fn(), finishExecutionAuthorization: vi.fn(),
}));
vi.mock("@/lib/agent/tool-executor", () => ({ executeRegisteredTool: vi.fn() }));

const stored = new Map<string, { userId: string; planHash: string;
  state: "issued" | "started" | "succeeded" | "failed" }>();

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
  stored.clear();
  vi.mocked(persistExecutionAuthorization).mockImplementation(async (userId, issue) => {
    stored.set(issue.jti, { userId, planHash: issue.planHash, state: "issued" });
  });
  vi.mocked(consumeExecutionAuthorization).mockImplementation(async (userId, issue) => {
    const record = stored.get(issue.jti);
    if (!record || record.userId !== userId || record.planHash !== issue.planHash) return "missing";
    if (record.state === "issued") { record.state = "started"; return "acquired"; }
    return "replay";
  });
  vi.mocked(finishExecutionAuthorization).mockImplementation(async (_userId, jti, success) => {
    const record = stored.get(jti);
    if (record) record.state = success ? "succeeded" : "failed";
  });
  vi.mocked(executeRegisteredTool).mockImplementation(async () => ({
    tool: "read_current_time", ok: true, data: { iso: new Date().toISOString() },
  }));
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
    expect(persistExecutionAuthorization).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(persistExecutionAuthorization).mock.calls[0][1];
    expect(Object.keys(persisted).sort()).toEqual(["expiresAt", "jti", "planHash"]);
    expect(JSON.stringify(persisted)).not.toContain(authorization);
    expect(JSON.stringify(persisted)).not.toContain(plan.goal);
    expect(consumeExecutionAuthorization).toHaveBeenCalledTimes(1);
    expect(consumeExecutionAuthorization).toHaveBeenCalledWith("user-a", {
      tool: "read_current_time", jti: persisted.jti, planHash: persisted.planHash,
    });
    expect(finishExecutionAuthorization).toHaveBeenCalledWith("user-a", expect.any(String), true, null);
  });

  it("does not return an execution token before its authorization is persisted", async () => {
    let releasePersistence: (() => void) | undefined;
    vi.mocked(persistExecutionAuthorization).mockImplementationOnce(() => new Promise<void>((resolve) => {
      releasePersistence = resolve;
    }));
    let settled = false;
    const pending = confirm(request("confirm", { planAuthorization: issuePlanAuthorization("user-a", plan), plan }))
      .then((response) => { settled = true; return response; });
    await vi.waitFor(() => expect(persistExecutionAuthorization).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    releasePersistence?.();
    expect((await pending).status).toBe(200);
  });

  it("rejects a second use and never calls the handler twice", async () => {
    const confirmed = await confirm(request("confirm", { planAuthorization: issuePlanAuthorization("user-a", plan), plan }));
    const { authorization } = await confirmed.json();
    expect((await execute(request("execute", { authorization }))).status).toBe(200);
    const replay = await execute(request("execute", { authorization }));
    expect(replay.status).toBe(409);
    expect((await replay.json()).error.code).toBe("REPLAY_REJECTED");
    expect(executeRegisteredTool).toHaveBeenCalledTimes(1);
  });

  it("permits at most one concurrent request to reach the handler", async () => {
    const confirmed = await confirm(request("confirm", { planAuthorization: issuePlanAuthorization("user-a", plan), plan }));
    const { authorization } = await confirmed.json();
    const responses = await Promise.all([execute(request("execute", { authorization })),
      execute(request("execute", { authorization }))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(executeRegisteredTool).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed handler authorization consumed", async () => {
    vi.mocked(executeRegisteredTool).mockRejectedValueOnce(new Error("private handler detail"));
    const confirmed = await confirm(request("confirm", { planAuthorization: issuePlanAuthorization("user-a", plan), plan }));
    const { authorization } = await confirmed.json();
    expect((await execute(request("execute", { authorization }))).status).toBe(503);
    expect((await execute(request("execute", { authorization }))).status).toBe(409);
    expect(finishExecutionAuthorization).toHaveBeenCalledWith("user-a", expect.any(String), false, "TOOL_FAILED");
    expect(executeRegisteredTool).toHaveBeenCalledTimes(1);
  });

  it("rejects expired and cross-user confirmed authorizations before database consumption", async () => {
    const confirmed = await confirm(request("confirm", { planAuthorization: issuePlanAuthorization("user-a", plan), plan }));
    const { authorization } = await confirmed.json();
    authenticated("user-b");
    expect((await execute(request("execute", { authorization }))).status).toBe(400);
    authenticated("user-a");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    try { expect((await execute(request("execute", { authorization }))).status).toBe(400); }
    finally { clock.mockRestore(); }
    expect(consumeExecutionAuthorization).not.toHaveBeenCalled();
    expect(executeRegisteredTool).not.toHaveBeenCalled();
  });

  it("fails closed when issuance or consumption cannot be persisted", async () => {
    vi.mocked(persistExecutionAuthorization).mockRejectedValueOnce(new Error("private DB detail"));
    const failedConfirm = await confirm(request("confirm", { planAuthorization: issuePlanAuthorization("user-a", plan), plan }));
    expect(failedConfirm.status).toBe(503);
    expect(JSON.stringify(await failedConfirm.json())).not.toContain("private DB detail");
    const confirmed = await confirm(request("confirm", { planAuthorization: issuePlanAuthorization("user-a", plan), plan }));
    const { authorization } = await confirmed.json();
    vi.mocked(consumeExecutionAuthorization).mockRejectedValueOnce(new Error("private DB detail"));
    const failedExecute = await execute(request("execute", { authorization }));
    expect(failedExecute.status).toBe(503);
    expect(executeRegisteredTool).not.toHaveBeenCalled();
    expect(JSON.stringify(await failedExecute.json())).not.toContain("private DB detail");
  });

  it("does not execute when a valid token has no matching persisted authorization", async () => {
    const confirmed = await confirm(request("confirm", { planAuthorization: issuePlanAuthorization("user-a", plan), plan }));
    const { authorization } = await confirmed.json();
    vi.mocked(consumeExecutionAuthorization).mockResolvedValueOnce("missing");
    const response = await execute(request("execute", { authorization }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(executeRegisteredTool).not.toHaveBeenCalled();
    expect(finishExecutionAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a correctly signed token whose Plan hash differs from the persisted authorization", async () => {
    const confirmed = await confirm(request("confirm", { planAuthorization: issuePlanAuthorization("user-a", plan), plan }));
    const { authorization } = await confirmed.json();
    const [encoded] = authorization.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const altered = Buffer.from(JSON.stringify({ ...payload, planHash: "0".repeat(64) })).toString("base64url");
    const signature = createHmac("sha256", process.env.AGENT_EXECUTION_SECRET!).update(altered).digest("base64url");
    const response = await execute(request("execute", { authorization: `${altered}.${signature}` }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(executeRegisteredTool).not.toHaveBeenCalled();
    expect((await execute(request("execute", { authorization }))).status).toBe(200);
  });

  it("fails closed if completion auditing fails after the tool runs", async () => {
    const confirmed = await confirm(request("confirm", { planAuthorization: issuePlanAuthorization("user-a", plan), plan }));
    const { authorization } = await confirmed.json();
    vi.mocked(finishExecutionAuthorization).mockRejectedValueOnce(new Error("private audit detail"));
    const response = await execute(request("execute", { authorization }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("EXECUTION_UNAVAILABLE");
    expect(executeRegisteredTool).toHaveBeenCalledTimes(1);
    const replay = await execute(request("execute", { authorization }));
    expect(replay.status).toBe(409);
    expect(executeRegisteredTool).toHaveBeenCalledTimes(1);
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
