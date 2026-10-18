import { afterEach, describe, expect, it, vi } from "vitest";
import { AIRequestDeadline } from "../request-deadline";
import { AIRequestDiagnostics } from "../diagnostics";

afterEach(() => vi.useRealTimers());

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

  it("retains the first abort reason when attempt and client aborts race", () => {
    for (const first of ["client", "attempt"] as const) {
      const client = new AbortController();
      const timeout = new AbortController();
      const deadline = new AIRequestDeadline(client.signal);
      try {
        const attempt = deadline.attemptSignals(25_000, () => timeout.signal);
        if (first === "client") { client.abort(); timeout.abort(); }
        else { timeout.abort(); client.abort(); }
        expect(attempt.abortOrigin()).toBe(first === "client" ? "client_abort" : "provider_attempt_timeout");
      } finally { deadline.close(); }
    }
  });

  it("retains the shared deadline when it precedes an attempt abort", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const client = new AbortController();
    const timeout = new AbortController();
    const deadline = new AIRequestDeadline(client.signal, 20);
    try {
      const attempt = deadline.attemptSignals(20, () => timeout.signal);
      await vi.advanceTimersByTimeAsync(20);
      timeout.abort();
      client.abort();
      expect(attempt.abortOrigin()).toBe("shared_deadline");
      expect(deadline.abortOrigin).toBe("shared_deadline");
    } finally { deadline.close(); }
  });

  it("uses event order even when different abort sources reuse the same reason", () => {
    const client = new AbortController();
    const timeout = new AbortController();
    const deadline = new AIRequestDeadline(client.signal);
    try {
      const attempt = deadline.attemptSignals(25_000, () => timeout.signal);
      client.abort("same-reason");
      timeout.abort("same-reason");
      expect(attempt.abortOrigin()).toBe("client_abort");
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
