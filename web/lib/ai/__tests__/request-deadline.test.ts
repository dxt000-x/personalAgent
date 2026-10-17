import { describe, expect, it } from "vitest";
import { AIRequestDeadline } from "../request-deadline";
import { AIRequestDiagnostics } from "../diagnostics";

describe("AI request deadline and safe diagnostics", () => {
  it("returns TIMEOUT at the total deadline even when an uncancellable operation never settles", async () => {
    const deadline = new AIRequestDeadline(new AbortController().signal, 20);
    try {
      await expect(deadline.wait(new Promise<never>(() => {}))).rejects.toMatchObject({ code: "TIMEOUT" });
      expect(deadline.signal.aborted).toBe(true);
    } finally { deadline.close(); }
  });

  it("propagates a client abort to an attempt signal", () => {
    const client = new AbortController();
    const deadline = new AIRequestDeadline(client.signal);
    try {
      const attempt = deadline.attemptSignal(1000);
      client.abort();
      expect(attempt.aborted).toBe(true);
      expect(() => deadline.assertRemaining()).toThrowError(expect.objectContaining({ code: "TIMEOUT" }));
    } finally { deadline.close(); }
  });

  it("keeps diagnostic records to allowlisted durations and identifiers", async () => {
    const trace = new AIRequestDiagnostics("chat");
    trace.setRouting("auto", "privacy");
    trace.setMemoryFailure("timeout");
    trace.attempt("ollama");
    await trace.measure("providerDurationMs", async () => "fake private response");
    const record = trace.snapshot("TIMEOUT");
    expect(record).toMatchObject({ endpoint: "chat", routingMode: "privacy", provider: "ollama", attemptNumber: 1,
      memoryFailureKind: "timeout", finalErrorCode: "TIMEOUT" });
    expect(record).not.toHaveProperty("messages");
    expect(record).not.toHaveProperty("response");
    expect(record).not.toHaveProperty("userId");
    expect(JSON.stringify(record)).not.toContain("fake private response");
  });

  it("includes the elapsed active provider phase when the request times out first", () => {
    const trace = new AIRequestDiagnostics("plan");
    trace.attempt("openrouter");
    void trace.measure("providerDurationMs", () => new Promise<never>(() => {}));
    const record = trace.snapshot("TIMEOUT");
    expect(record).toMatchObject({ endpoint: "plan", provider: "openrouter", attemptNumber: 1,
      providerDurationMs: expect.any(Number), finalErrorCode: "TIMEOUT" });
    expect(record).not.toHaveProperty("messages");
  });
});
