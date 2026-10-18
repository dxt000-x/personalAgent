import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterProvider } from "../openrouter-provider";
import { PROVIDER_TIMEOUT_MS } from "../limits";

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
});
