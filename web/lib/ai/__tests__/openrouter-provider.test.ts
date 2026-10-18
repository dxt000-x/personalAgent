import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterProvider } from "../openrouter-provider";
import { MAX_OUTPUT_TOKENS, PROVIDER_TIMEOUT_MS } from "../limits";
import { ProviderResponseError } from "../errors";

const mocks = vi.hoisted(() => ({ create: vi.fn(), config: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  chat = { completions: { create: mocks.create } };
  constructor(options: unknown) { mocks.config(options); }
} }));

beforeEach(() => vi.resetAllMocks());

describe("OpenRouter provider with an offline SDK mock", () => {
  it("keeps the SDK timeout after the Gateway attempt limit", () => {
    createOpenRouterProvider("fake-key", "fake-model");
    expect(mocks.config).toHaveBeenCalledWith(expect.objectContaining({
      timeout: PROVIDER_TIMEOUT_MS + 1_000, maxRetries: 0,
    }));
  });

  it("rejects an empty completed response as an internal provider error", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: "" } }] });
    const provider = createOpenRouterProvider("fake-key", "fake-model");
    await expect(provider.generate([{ role: "user", content: "private task" }], new AbortController().signal))
      .rejects.toMatchObject({ code: "PROVIDER_ERROR", status: 502 });
  });

  it.each([
    { response: { choices: [] }, failure: "empty_choices" },
    { response: { choices: [{}] }, failure: "missing_content" },
    { response: { choices: [{ message: { content: null } }] }, failure: "missing_content" },
    { response: { choices: [{ message: { content: "   " } }] }, failure: "empty_content" },
    { response: { choices: [{ message: { content: 42 } }] }, failure: "malformed_response" },
    { response: {}, failure: "malformed_response" },
  ])("classifies $failure without exposing response content", async ({ response, failure }) => {
    mocks.create.mockResolvedValue(response);
    const provider = createOpenRouterProvider("fake-key", "fake-model");
    const result = provider.generate([{ role: "user", content: "private task" }], new AbortController().signal);
    await expect(result).rejects.toBeInstanceOf(ProviderResponseError);
    await expect(result).rejects.toMatchObject({ failure, code: "PROVIDER_ERROR", status: 502 });
  });

  it("requests a complete non-streaming response and forwards the attempt signal", async () => {
    const controller = new AbortController();
    mocks.create.mockImplementation((_body: unknown, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("mock cancellation")), { once: true });
      }));
    const provider = createOpenRouterProvider("fake-key", "fake-model");
    const pending = provider.generate([{ role: "user", content: "private task" }], controller.signal, "planning rules");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      model: "fake-model", stream: false, max_tokens: MAX_OUTPUT_TOKENS,
    }), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("mock cancellation");
  });
});
