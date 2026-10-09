import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaProvider } from "../ollama-provider";

afterEach(() => vi.unstubAllGlobals());

describe("Ollama request options with fake fetch", () => {
  it("disables thinking only for qwen3:8b candidate extraction", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: { content: "fake reply" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOllamaProvider("http://localhost.invalid", "qwen3:8b");
    const messages = [{ role: "user" as const, content: "fake message" }];
    const signal = new AbortController().signal;
    await provider.generate(messages, signal);
    await provider.generate(messages, signal, "fake instruction", { disableThinking: true });
    const normal = JSON.parse(fetchMock.mock.calls[0][1].body);
    const extraction = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(normal).not.toHaveProperty("think");
    expect(extraction.think).toBe(false);
    expect(extraction.messages[0]).toEqual({ role: "system", content: "fake instruction" });
    expect(fetchMock.mock.calls[1][1].signal).toBe(signal);
  });

  it("does not assume other model tags support disabling thinking", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: { content: "fake reply" } }) });
    vi.stubGlobal("fetch", fetchMock);
    await createOllamaProvider("http://localhost.invalid", "another-model")
      .generate([{ role: "user", content: "fake" }], new AbortController().signal, undefined, { disableThinking: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("think");
  });

  it("classifies a response-body abort as TIMEOUT", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => {
      controller.abort();
      throw new Error("fake parse error with secret");
    } }));
    await expect(createOllamaProvider("http://localhost.invalid", "qwen3:8b")
      .generate([{ role: "user", content: "fake" }], controller.signal)).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
