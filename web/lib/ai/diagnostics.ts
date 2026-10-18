import "server-only";
import type { AIErrorCode, ProviderResponseFailure } from "./errors";
import type { ProviderId, ProviderLifecycleEvent, ProviderSelection, RoutingPreference } from "./types";

type Phase = "authDurationMs" | "validationDurationMs" | "memoryDurationMs" | "routeDurationMs"
  | "quotaDurationMs" | "providerDurationMs" | "dedupeDurationMs";
type FinalCode = AIErrorCode | "SUCCESS" | "CLIENT_ABORTED";
export type FailureOrigin = "provider_attempt_timeout" | "shared_deadline" | "client_abort"
  | "sdk_timeout" | "upstream_http" | "unknown";
export type FailureKind = ProviderResponseFailure | "provider_attempt_timeout" | "shared_deadline"
  | "client_abort" | "abort_race_unknown" | "timeout_source_unknown" | "sdk_timeout" | "upstream_http_error"
  | "sdk_connection_error" | "response_parse_error" | "sdk_api_error"
  | "internal_gateway_error" | "unexpected_provider_error" | "plan_invalid_output"
  | "route_unexpected_error";

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
  private failureKind?: FailureKind;
  private providerLifecycle: ProviderLifecycleEvent[] = [];
  private finished = false;

  constructor(private readonly endpoint: "chat" | "memory-candidates" | "plan") {}

  setRouting(provider: ProviderSelection, preference: RoutingPreference): void {
    this.routingMode = provider === "auto" ? preference : "explicit";
  }

  setMemoryFailure(kind: "timeout" | "database" | "network" | undefined): void {
    this.memoryFailureKind = kind;
  }

  setFailureOrigin(origin: FailureOrigin): void { this.failureOrigin = origin; }

  setFailureKind(kind: FailureKind): void { this.failureKind = kind; }

  get hasFailureOrigin(): boolean { return this.failureOrigin !== undefined; }

  get hasFailureKind(): boolean { return this.failureKind !== undefined; }

  recordProviderLifecycle(event: ProviderLifecycleEvent): void {
    if (this.finished || this.providerLifecycle.length >= 5) return;
    // Only OpenRouter's fixed lifecycle events are accepted. Headers and identifiers are never logged wholesale.
    const elapsedMs = Math.round(Math.max(0, Math.min(30_000, event.elapsedMs)));
    if (event.event === "response_headers") {
      if (!Number.isInteger(event.status) || event.status < 100 || event.status > 599) return;
      const upstreamRequestId = event.upstreamRequestId && /^[A-Za-z0-9_-]{1,128}$/.test(event.upstreamRequestId)
        ? event.upstreamRequestId : undefined;
      this.providerLifecycle.push({ event: event.event, elapsedMs, status: event.status,
        ...(upstreamRequestId ? { upstreamRequestId } : {}) });
    } else if (event.event === "request_aborted" || event.event === "request_failed") {
      this.providerLifecycle.push({ event: event.event, elapsedMs, stage: event.stage });
    } else {
      this.providerLifecycle.push({ event: event.event, elapsedMs });
    }
  }

  attempt(provider: ProviderId): void {
    // A later Auto candidate supersedes the previous attempt's diagnostic outcome.
    this.failureOrigin = undefined;
    this.failureKind = undefined;
    this.providerLifecycle = [];
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
      ...(this.failureKind ? { failureKind: this.failureKind } : {}),
      ...(this.providerLifecycle.length ? { providerLifecycle: this.providerLifecycle } : {}),
      finalErrorCode,
    };
  }

  finish(finalErrorCode: FinalCode): void {
    if (this.finished) return;
    this.finished = true;
    if (process.env.NODE_ENV !== "test") console.info(JSON.stringify(this.snapshot(finalErrorCode)));
  }
}
