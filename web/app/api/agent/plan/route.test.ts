import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { AIGatewayError } from "@/lib/ai/errors";
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

describe("POST /api/agent/plan", () => {
  it("rejects unauthenticated requests before model work", async () => {
    vi.mocked(createClient).mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED", message: "请先登录。" } });
    expect(runAiGateway).not.toHaveBeenCalled();
  });

  it("passes the validated task, provider and planning instruction to the shared Gateway", async () => {
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

  it.each(["not JSON", JSON.stringify({ ...plan, requiresConfirmation: false })])(
    "rejects invalid model output with a fixed safe error", async (text) => {
      vi.mocked(runAiGateway).mockResolvedValue({ text, provider: "ollama", model: "fake-local" });
      const response = await POST(request());
      const body = await response.json();
      expect(response.status).toBe(502);
      expect(body.error.code).toBe("PROVIDER_ERROR");
      expect(JSON.stringify(body)).not.toContain(text);
      expect(body.plan).toBeUndefined();
    },
  );

  it("preserves the standard safe Gateway error response", async () => {
    vi.mocked(runAiGateway).mockRejectedValue(new AIGatewayError("RATE_LIMITED"));
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("RATE_LIMITED");
  });

  it("does not expose unexpected SDK error details", async () => {
    vi.mocked(runAiGateway).mockRejectedValue(new Error("secret provider request detail"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("PROVIDER_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret provider request detail");
  });
});
