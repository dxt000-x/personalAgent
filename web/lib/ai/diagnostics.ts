import "server-only";
import type { AIErrorCode } from "./errors";
import type { ProviderId, ProviderSelection, RoutingPreference } from "./types";

type Phase = "authDurationMs" | "validationDurationMs" | "memoryDurationMs" | "routeDurationMs"
  | "quotaDurationMs" | "providerDurationMs" | "dedupeDurationMs";
type FinalCode = AIErrorCode | "SUCCESS" | "CLIENT_ABORTED";
export type FailureOrigin = "provider_attempt_timeout" | "shared_deadline" | "client_abort"
  | "sdk_timeout" | "upstream_http" | "unknown";

/** Allowlisted operational fields only. Never add request, response, headers or Memory content here. */
export class AIRequestDiagnostics {
  readonly requestId = crypto.randomUUID();
  private readonly startedAt = performance.now();
  private readonly durations: Partial<Record<Phase, number>> = {};
  private readonly activePhases = new Map<Phase, number>();
  private provider?: ProviderId;
  private routingMode?: "auto" | "privacy" | "explicit";
  private attempts = 0;
  private memoryFailureKind?: "timeout" | "database" | "network";
  private failureOrigin?: FailureOrigin;
  private finished = false;

  constructor(private readonly endpoint: "chat" | "memory-candidates" | "plan") {}

  setRouting(provider: ProviderSelection, preference: RoutingPreference): void {
    this.routingMode = provider === "auto" ? preference : "explicit";
  }

  setMemoryFailure(kind: "timeout" | "database" | "network" | undefined): void {
    this.memoryFailureKind = kind;
  }

  setFailureOrigin(origin: FailureOrigin): void { this.failureOrigin = origin; }

  get hasFailureOrigin(): boolean { return this.failureOrigin !== undefined; }

  attempt(provider: ProviderId): void {
    // A later Auto candidate supersedes the previous attempt's diagnostic outcome.
    this.failureOrigin = undefined;
    this.provider = provider;
    this.attempts += 1;
  }

  async measure<T>(phase: Phase, operation: () => Promise<T>): Promise<T> {
    const start = performance.now();
    this.activePhases.set(phase, start);
    try { return await operation(); }
    finally {
      this.durations[phase] = Math.round((this.durations[phase] ?? 0) + performance.now() - start);
      this.activePhases.delete(phase);
    }
  }

  snapshot(finalErrorCode: FinalCode) {
    const durations = { ...this.durations };
    for (const [phase, start] of this.activePhases) {
      durations[phase] = Math.round((durations[phase] ?? 0) + performance.now() - start);
    }
    return {
      event: "ai_gateway_request",
      requestId: this.requestId,
      endpoint: this.endpoint,
      ...(this.provider ? { provider: this.provider } : {}),
      ...(this.routingMode ? { routingMode: this.routingMode } : {}),
      ...durations,
      totalDurationMs: Math.round(performance.now() - this.startedAt),
      attemptNumber: this.attempts,
      ...(this.memoryFailureKind ? { memoryFailureKind: this.memoryFailureKind } : {}),
      ...(this.failureOrigin ? { failureOrigin: this.failureOrigin } : {}),
      finalErrorCode,
    };
  }

  finish(finalErrorCode: FinalCode): void {
    if (this.finished) return;
    this.finished = true;
    if (process.env.NODE_ENV !== "test") console.info(JSON.stringify(this.snapshot(finalErrorCode)));
  }
}
