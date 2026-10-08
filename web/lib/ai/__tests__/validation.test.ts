import { describe, expect, it } from "vitest";
import { MAX_INPUT_CHARACTERS, MAX_MESSAGE_CHARACTERS, MAX_MESSAGES, MAX_REQUEST_BYTES } from "../limits";
import { readJsonBody, validateChatRequest } from "../request";

const message = (content = "hello", role = "user") => ({ role, content });
const input = (messages: unknown = [message()], provider: unknown = "auto", routingPreference: unknown = "auto") => ({
  provider, routingPreference, messages,
});

describe("AI chat request validation", () => {
  it("accepts a normal conversation and defaults the routing preference", () => {
    expect(validateChatRequest({ provider: "auto", messages: [message("hi"), message("hello", "assistant"), message("next")] }))
      .toMatchObject({ provider: "auto", routingPreference: "auto", messages: [message("hi"), message("hello", "assistant"), message("next")] });
  });

  it("rejects empty messages", () => {
    expect(() => validateChatRequest(input([]))).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("accepts exactly the maximum message count and rejects one more", () => {
    expect(validateChatRequest(input(Array.from({ length: MAX_MESSAGES }, () => message("x")))).messages).toHaveLength(MAX_MESSAGES);
    expect(() => validateChatRequest(input(Array.from({ length: MAX_MESSAGES + 1 }, () => message("x")))))
      .toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("accepts a message at the character limit and rejects the next character", () => {
    expect(validateChatRequest(input([message("x".repeat(MAX_MESSAGE_CHARACTERS))])).messages[0].content).toHaveLength(MAX_MESSAGE_CHARACTERS);
    expect(() => validateChatRequest(input([message("x".repeat(MAX_MESSAGE_CHARACTERS + 1))])))
      .toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("accepts the total input boundary and rejects one character beyond it", () => {
    const boundary = Array.from({ length: MAX_INPUT_CHARACTERS / MAX_MESSAGE_CHARACTERS }, () => message("x".repeat(MAX_MESSAGE_CHARACTERS)));
    expect(validateChatRequest(input(boundary)).messages).toHaveLength(boundary.length);
    expect(() => validateChatRequest(input([...boundary, message("x")])))
      .toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it.each([
    ["invalid role", input([message("hello", "system")])],
    ["invalid provider", input([message()], "unknown")],
    ["invalid routing preference", input([message()], "auto", "cloud")],
    ["cloud provider with Privacy", input([message()], "openrouter", "privacy")],
    ["assistant as final message", input([message("hello", "assistant")])],
  ])("rejects %s", (_label, value) => {
    expect(() => validateChatRequest(value)).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("accepts a JSON body at the byte limit and rejects an oversized body", async () => {
    const prefix = '{"padding":"';
    const suffix = '"}';
    const atLimit = `${prefix}${"x".repeat(MAX_REQUEST_BYTES - prefix.length - suffix.length)}${suffix}`;
    const makeRequest = (body: string) => new Request("http://localhost/api/ai/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    expect(await readJsonBody(makeRequest(atLimit))).toHaveProperty("padding");
    await expect(readJsonBody(makeRequest(`${atLimit} `))).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 413 });
  });
});
