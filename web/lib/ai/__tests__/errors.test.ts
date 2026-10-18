import { describe, expect, it, vi } from "vitest";
import { AIGatewayError, providerFailure } from "../errors";
import OpenAI from "openai";
import { aiErrorResponse } from "../http";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

describe("public AI errors", () => {
  it.each([
    ["AUTH_REQUIRED", 401],
    ["PROVIDER_NOT_CONFIGURED", 503],
    ["PRIVACY_PROVIDER_UNAVAILABLE", 503],
    ["INVALID_REQUEST", 400],
    ["PROVIDER_AUTH_FAILED", 502],
    ["PROVIDER_REQUEST_REJECTED", 502],
    ["PROVIDER_ERROR", 502],
    ["RATE_LIMITED", 429],
    ["CLOUD_QUOTA_EXCEEDED", 429],
    ["QUOTA_UNAVAILABLE", 503],
    ["TIMEOUT", 504],
  ] as const)("maps %s to a safe HTTP %i response", async (code, status) => {
    const response = aiErrorResponse(new AIGatewayError(code));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message: expect.any(String) } });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("does not expose upstream exceptions, credentials or sensitive headers", async () => {
    const secrets = [
      "sk-test-secret-do-not-leak",
      "OPENROUTER_API_KEY=fake-secret",
      "OPENAI_API_KEY=fake-secret",
      "DEEPSEEK_API_KEY=fake-secret",
      "GEMINI_API_KEY=fake-secret",
      "Cookie: fake-session",
      "JWT fake.jwt.value",
      "Bearer fake-access-token",
      "x-provider-secret: fake-header",
    ];
    const internal = new Error(secrets.join(" | "));
    internal.stack = `fake stack: ${secrets.join(" | ")}`;
    const response = aiErrorResponse(internal);
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(JSON.parse(body).error.code).toBe("PROVIDER_ERROR");
    for (const secret of secrets) expect(body).not.toContain(secret);
    expect(body).not.toContain("stack");
  });

  it("classifies upstream 429 and aborts without exposing raw errors", () => {
    const signal = new AbortController().signal;
    expect(providerFailure({ status: 429, message: "fake private header" }, signal).code).toBe("RATE_LIMITED");
    expect(providerFailure({ status: 429, message: "fake private header" }, AbortSignal.abort()).code).toBe("RATE_LIMITED");
    expect(providerFailure({ name: "AbortError", message: "fake secret" }, signal).code).toBe("TIMEOUT");
    expect(providerFailure(new Error("fake secret"), signal).code).toBe("PROVIDER_ERROR");
    expect(providerFailure(new Error("fake secret"), AbortSignal.abort()).code).toBe("TIMEOUT");
  });

  it.each([400, 402, 404, 405, 409, 413, 415, 422])("classifies upstream HTTP %i as a safe non-fallback request rejection", (status) => {
    expect(providerFailure({ status, message: "sk-test-secret-do-not-leak" }, new AbortController().signal).code)
      .toBe("PROVIDER_REQUEST_REJECTED");
  });

  it.each([401, 403])("does not confuse upstream HTTP %i with the current user's authentication", (status) => {
    expect(providerFailure({ status, message: "sk-test-secret-do-not-leak" }, new AbortController().signal).code)
      .toBe("PROVIDER_AUTH_FAILED");
  });

  it("keeps upstream 429, 5xx, network failures and timeouts distinct", () => {
    const signal = new AbortController().signal;
    expect(providerFailure({ status: 429 }, signal).code).toBe("RATE_LIMITED");
    expect(providerFailure({ status: 503 }, signal).code).toBe("PROVIDER_ERROR");
    expect(providerFailure(new Error("network failed"), signal).code).toBe("PROVIDER_ERROR");
    expect(providerFailure({ status: 408 }, signal).code).toBe("TIMEOUT");
    // SDK v6 uses Error as the instance name, so classify by type rather than name alone.
    expect(providerFailure(new OpenAI.APIConnectionTimeoutError(), signal).code).toBe("TIMEOUT");
  });
});
