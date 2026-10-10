import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGroqProvider } from "../groq-provider";
import { providerFailure } from "../errors";
import { MAX_OUTPUT_CHARACTERS, MAX_OUTPUT_TOKENS, PROVIDER_TIMEOUT_MS } from "../limits";

vi.mock("server-only", () => ({}));
const sdk = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  chat = { completions: { create: sdk.create } };
  constructor(options: unknown) { sdk.options(options); }
} }));

const messages = [{ role: "user" as const, content: "fake user" }, { role: "assistant" as const, content: "fake assistant" }];
const signal = new AbortController().signal;

beforeEach(() => {
  sdk.create.mockReset();
  sdk.options.mockReset();
  sdk.create.mockResolvedValue({ choices: [{ message: { content: "  fake answer  " } }], model: "groq-returned-model",
    usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } });
});

describe("Groq Provider through the installed OpenAI-compatible SDK", () => {
  it("uses Groq endpoint, disables SDK retries, sends system context and maps usage", async () => {
    const result = await createGroqProvider("fake-test-key", "fake-model").generate(messages, signal, "fake system");
    expect(sdk.options).toHaveBeenCalledWith({ apiKey: "fake-test-key", baseURL: "https://api.groq.com/openai/v1",
      maxRetries: 0, timeout: PROVIDER_TIMEOUT_MS });
    expect(sdk.create).toHaveBeenCalledWith({ model: "fake-model", messages: [
      { role: "system", content: "fake system" }, ...messages,
    ], max_completion_tokens: MAX_OUTPUT_TOKENS, stream: false }, { signal });
    expect(result).toEqual({ text: "fake answer", provider: "groq", model: "groq-returned-model",
      usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 } });
  });

  it("uses low reasoning only for the supported default GPT-OSS model", async () => {
    await createGroqProvider("fake-test-key", "openai/gpt-oss-20b").generate(messages, signal, undefined, { disableThinking: true });
    expect(sdk.create.mock.calls[0][0]).toMatchObject({
      model: "openai/gpt-oss-20b", max_completion_tokens: MAX_OUTPUT_TOKENS, reasoning_effort: "low",
    });
    expect(sdk.create.mock.calls[0][0]).not.toHaveProperty("max_tokens");
    await createGroqProvider("fake-test-key", "fake-custom-model").generate(messages, signal);
    expect(sdk.create.mock.calls[1][0]).not.toHaveProperty("reasoning_effort");
    expect(sdk.create.mock.calls[1][0]).toHaveProperty("max_completion_tokens", MAX_OUTPUT_TOKENS);
  });

  it("rejects empty replies and limits output length", async () => {
    sdk.create.mockResolvedValueOnce({ choices: [{ message: { content: "  " } }] });
    await expect(createGroqProvider("fake-test-key", "fake-model").generate(messages, signal))
      .rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    sdk.create.mockResolvedValueOnce({ choices: [{ message: { content: "x".repeat(MAX_OUTPUT_CHARACTERS + 10) } }] });
    const result = await createGroqProvider("fake-test-key", "fake-model").generate(messages, signal);
    expect(result.text).toHaveLength(MAX_OUTPUT_CHARACTERS);
    expect(result.model).toBe("fake-model");
  });

  it("maps upstream rate limit, timeout and network failures to safe errors", async () => {
    const failures = [
      [Object.assign(new Error("fake-secret"), { status: 429 }), "RATE_LIMITED"],
      [Object.assign(new Error("fake-secret"), { name: "APIConnectionTimeoutError" }), "TIMEOUT"],
      [new Error("fake-secret"), "PROVIDER_ERROR"],
    ] as const;
    for (const [error, code] of failures) {
      sdk.create.mockRejectedValueOnce(error);
      try {
        await createGroqProvider("fake-test-key", "fake-model").generate(messages, signal);
        throw new Error("Expected a simulated failure");
      } catch (caught) {
        const publicError = providerFailure(caught, signal);
        expect(publicError.code).toBe(code);
        expect(JSON.stringify({ code: publicError.code, message: publicError.message })).not.toContain("fake-secret");
      }
    }
  });

  it("forwards AbortSignal so a cancelled request cannot continue", async () => {
    const controller = new AbortController();
    sdk.create.mockImplementationOnce((_body, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("fake abort"), { name: "AbortError" })), { once: true });
    }));
    const pending = createGroqProvider("fake-test-key", "fake-model").generate(messages, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(sdk.create.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
