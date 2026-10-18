import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { AIGatewayError } from "@/lib/ai/errors";
import { AIRequestDiagnostics } from "@/lib/ai/diagnostics";
import { AI_REQUEST_DEADLINE_MS } from "@/lib/ai/request-deadline";
import { runAiGateway } from "@/lib/ai/gateway";
import { createClient } from "@/lib/supabase/server";
import { issuePlanAuthorization } from "@/lib/agent/execution-authorization";

vi.mock("@/lib/ai/gateway", () => ({ runAiGateway: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/agent/execution-authorization", () => ({ issuePlanAuthorization: vi.fn(() => "signed-plan-token") }));

const plan = {
  version: 1,
  goal: "整理学习计划",
  steps: [{ id: "step-1", title: "列出目标", description: "确认本周学习目标。", status: "pending" }],
  requiresConfirmation: true,
};

function request(body: unknown = {
  provider: "auto", routingPreference: "auto", messages: [{ role: "user", content: "帮我制定学习计划" }],
}, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/agent/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  const client = { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "user-a" } }, error: null }) } };
  vi.mocked(createClient).mockResolvedValue(client as unknown as NonNullable<Awaited<ReturnType<typeof createClient>>>);
  vi.mocked(runAiGateway).mockResolvedValue({ text: JSON.stringify(plan), provider: "ollama", model: "fake-local" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/agent/plan", () => {
  it("rejects unauthenticated requests before model work", async () => {
    vi.mocked(createClient).mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED", message: "请先登录。" } });
    expect(runAiGateway).not.toHaveBeenCalled();
  });

  it("passes the validated task, provider and planning instruction to the shared Gateway", async () => {
    const finish = vi.spyOn(AIRequestDiagnostics.prototype, "finish");
    const response = await POST(request({
      provider: "openrouter", routingPreference: "auto", messages: [{ role: "user", content: "帮我制定学习计划" }],
    }));
    expect(response.status).toBe(200);
    expect(runAiGateway).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runAiGateway).mock.calls[0][1]).toMatchObject({
      provider: "openrouter", routingPreference: "auto",
      messages: [{ role: "user", content: "帮我制定学习计划" }],
    });
    expect(vi.mocked(runAiGateway).mock.calls[0][1].systemInstruction).toContain("只能输出 JSON");
    expect(vi.mocked(runAiGateway).mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
    const diagnostics = vi.mocked(runAiGateway).mock.calls[0][3];
    expect(diagnostics).toBeInstanceOf(AIRequestDiagnostics);
    expect(diagnostics?.snapshot("SUCCESS")).toMatchObject({ endpoint: "plan", finalErrorCode: "SUCCESS",
      authDurationMs: expect.any(Number), validationDurationMs: expect.any(Number), attemptNumber: 0 });
    expect(finish).toHaveBeenCalledExactlyOnceWith("SUCCESS");
  });

  it("records quota failure once without logging task content", async () => {
    const finish = vi.spyOn(AIRequestDiagnostics.prototype, "finish");
    vi.mocked(runAiGateway).mockImplementation(async (_client, _input, _deadline, diagnostics) => {
      diagnostics?.setRouting("openrouter", "auto");
      await diagnostics?.measure("quotaDurationMs", async () => { throw new AIGatewayError("QUOTA_UNAVAILABLE"); });
      throw new Error("unreachable");
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("QUOTA_UNAVAILABLE");
    expect(finish).toHaveBeenCalledExactlyOnceWith("QUOTA_UNAVAILABLE");
    const diagnostics = vi.mocked(runAiGateway).mock.calls[0][3];
    const record = diagnostics?.snapshot("QUOTA_UNAVAILABLE");
    expect(record).toMatchObject({ endpoint: "plan", routingMode: "explicit",
      quotaDurationMs: expect.any(Number), attemptNumber: 0 });
    expect(JSON.stringify(record)).not.toContain("帮我制定学习计划");
  });

  it.each(["TIMEOUT", "PROVIDER_ERROR"] as const)("records %s after a provider attempt", async (code) => {
    const finish = vi.spyOn(AIRequestDiagnostics.prototype, "finish");
    vi.mocked(runAiGateway).mockImplementation(async (_client, _input, _deadline, diagnostics) => {
      diagnostics?.setRouting("auto", "auto");
      diagnostics?.attempt("openrouter");
      await diagnostics?.measure("providerDurationMs", async () => { throw new AIGatewayError(code); });
      throw new Error("unreachable");
    });
    const response = await POST(request());
    expect(response.status).toBe(code === "TIMEOUT" ? 504 : 502);
    expect((await response.json()).error.code).toBe(code);
    expect(finish).toHaveBeenCalledExactlyOnceWith(code);
    const record = vi.mocked(runAiGateway).mock.calls[0][3]?.snapshot(code);
    expect(record).toMatchObject({ endpoint: "plan", provider: "openrouter", routingMode: "auto",
      attemptNumber: 1, providerDurationMs: expect.any(Number), finalErrorCode: code });
    expect(JSON.stringify(record)).not.toContain("帮我制定学习计划");
  });

  it("logs the active provider phase once when the shared deadline expires before the provider settles", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    let finishProvider!: (result: Awaited<ReturnType<typeof runAiGateway>>) => void;
    vi.mocked(runAiGateway).mockImplementation((_client, _input, _deadline, diagnostics) => {
      diagnostics?.setRouting("auto", "auto");
      diagnostics?.attempt("openrouter");
      const pending = diagnostics!.measure("providerDurationMs", () => new Promise<Awaited<ReturnType<typeof runAiGateway>>>((resolve) => {
        finishProvider = resolve;
      }));
      providerStarted();
      return pending;
    });

    const responsePromise = POST(request({
      provider: "openrouter", messages: [{ role: "user", content: "private task sk-test-secret" }],
    }));
    await started;
    expect(log).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AI_REQUEST_DEADLINE_MS);
    const response = await responsePromise;
    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe("TIMEOUT");
    expect(log).toHaveBeenCalledTimes(1);
    const record = JSON.parse(log.mock.calls[0][0] as string);
    expect(record).toMatchObject({ endpoint: "plan", provider: "openrouter", routingMode: "auto",
      attemptNumber: 1, finalErrorCode: "TIMEOUT", failureOrigin: "shared_deadline",
      failureKind: "shared_deadline",
      providerDurationMs: expect.any(Number) });
    expect(record.providerDurationMs).toBeGreaterThanOrEqual(AI_REQUEST_DEADLINE_MS - 100);
    expect(record.totalDurationMs).toBeGreaterThanOrEqual(AI_REQUEST_DEADLINE_MS);
    expect(JSON.stringify(record)).not.toContain("private task");
    expect(JSON.stringify(record)).not.toContain("sk-test-secret");

    finishProvider({ text: JSON.stringify(plan), provider: "openrouter", model: "fake-cloud" });
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("classifies client cancellation without changing the safe response", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const controller = new AbortController();
    const cancelled = new Request("http://localhost:3000/api/agent/plan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        provider: "openrouter", messages: [{ role: "user", content: "private task" }],
      }), signal: controller.signal,
    });
    controller.abort();
    const response = await POST(cancelled);
    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe("TIMEOUT");
    expect(runAiGateway).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      finalErrorCode: "CLIENT_ABORTED", failureOrigin: "client_abort", failureKind: "client_abort",
    });
    expect(log.mock.calls[0][0]).not.toContain("private task");
  });

  it("returns only the parsed, pending, confirmation-required plan", async () => {
    vi.mocked(runAiGateway).mockResolvedValue({
      text: JSON.stringify({ ...plan, steps: [{ ...plan.steps[0], tool: "shell" }], debug: "internal" }),
      provider: "ollama", model: "fake-local",
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan, planAuthorization: "signed-plan-token" });
    expect(issuePlanAuthorization).toHaveBeenCalledWith("user-a", plan);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each([
    { task: "制定三天学习计划", count: 3 },
    { task: "制定复杂项目交付计划", count: 8 },
  ])("returns a complete valid plan for $task", async ({ task, count }) => {
    const generated = {
      ...plan,
      goal: task,
      steps: Array.from({ length: count }, (_, index) => ({
        id: `step-${index + 1}`,
        title: `阶段 ${index + 1}`,
        description: `完成第 ${index + 1} 阶段。`,
        status: "pending",
      })),
    };
    vi.mocked(runAiGateway).mockResolvedValue({
      text: JSON.stringify(generated), provider: "openrouter", model: "fake-cloud",
    });
    const response = await POST(request({ provider: "openrouter", messages: [{ role: "user", content: task }] }));
    expect(response.status).toBe(200);
    expect((await response.json()).plan.steps).toHaveLength(count);
    expect(issuePlanAuthorization).toHaveBeenCalledWith("user-a", generated);
  });

  it.each([
    { provider: "auto", messages: [{ role: "user", content: "" }] },
    { provider: "auto", messages: [{ role: "user", content: "x".repeat(1001) }] },
    { provider: "auto", messages: [{ role: "user", content: "one" }, { role: "user", content: "two" }] },
    { provider: "auto", messages: [{ role: "user", content: "task" }], knowledge: { enabled: true, query: "TCP" } },
    { provider: "auto", messages: [{ role: "user", content: "task" }], userId: "user-b" },
    { provider: "openrouter", routingPreference: "privacy", messages: [{ role: "user", content: "task" }] },
  ])("rejects invalid planning input before Gateway work: %#", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(runAiGateway).not.toHaveBeenCalled();
  });

  it("rejects a mismatched Origin", async () => {
    const response = await POST(request(undefined, { Origin: "http://other.invalid" }));
    expect(response.status).toBe(400);
    expect(runAiGateway).not.toHaveBeenCalled();
  });

  it.each(["not JSON", '{"version":1,"goal":"三天学习计划","steps":[',
    JSON.stringify({ ...plan, requiresConfirmation: false })])(
    "rejects invalid model output with a fixed safe error", async (text) => {
      vi.stubEnv("NODE_ENV", "development");
      const log = vi.spyOn(console, "info").mockImplementation(() => {});
      vi.mocked(runAiGateway).mockResolvedValue({ text, provider: "ollama", model: "fake-local" });
      const response = await POST(request());
      const body = await response.json();
      expect(response.status).toBe(502);
      expect(body.error.code).toBe("PROVIDER_ERROR");
      expect(JSON.stringify(body)).not.toContain(text);
      expect(body.plan).toBeUndefined();
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
        finalErrorCode: "PROVIDER_ERROR", failureKind: "plan_invalid_output",
      });
      expect(log.mock.calls[0][0]).not.toContain(text);
    },
  );

  it("preserves the standard safe Gateway error response", async () => {
    vi.mocked(runAiGateway).mockRejectedValue(new AIGatewayError("RATE_LIMITED"));
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("RATE_LIMITED");
  });

  it("does not expose unexpected SDK error details", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.mocked(runAiGateway).mockRejectedValue(new Error("secret provider request detail"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("PROVIDER_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret provider request detail");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      finalErrorCode: "PROVIDER_ERROR", failureKind: "route_unexpected_error",
    });
    expect(log.mock.calls[0][0]).not.toContain("secret provider request detail");
  });
});
