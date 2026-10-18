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

/** Inspect only the SDK's serialized JSON body; never retain or log other request fields. */
export function classifyOutgoingStream(body: BodyInit | null | undefined): "true" | "false" | "missing" | "invalid" {
  if (body === null || body === undefined) return "missing";
  if (typeof body !== "string") return "invalid";
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "invalid";
    if (!("stream" in parsed)) return "missing";
    return typeof parsed.stream === "boolean" ? String(parsed.stream) as "true" | "false" : "invalid";
  } catch { return "invalid"; }
}

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
    if (event.event === "request_started") {
      const status = event.outgoingStreamStatus;
      this.providerLifecycle.push({ event: event.event, elapsedMs,
        outgoingStreamStatus: status === "true" || status === "false" || status === "missing" ? status : "invalid" });
    } else if (event.event === "response_headers") {
      if (!Number.isInteger(event.status) || event.status < 100 || event.status > 599) return;
      const upstreamRequestId = event.upstreamRequestId && /^[A-Za-z0-9_-]{1,128}$/.test(event.upstreamRequestId)
        ? event.upstreamRequestId : undefined;
      const upstreamRequestIdStatus = event.upstreamRequestId === undefined ? "missing"
        : upstreamRequestId ? "present" : "invalid";
      const openrouterGenerationId = event.openrouterGenerationId
        && /^gen-[A-Za-z0-9_-]{1,128}$/.test(event.openrouterGenerationId)
        ? event.openrouterGenerationId : undefined;
      const openrouterGenerationIdStatus = event.openrouterGenerationId === undefined ? "missing"
        : openrouterGenerationId ? "present" : "invalid";
      const mediaType = event.contentType?.split(";", 1)[0].trim().toLowerCase();
      const contentType = mediaType === undefined ? "missing"
        : mediaType === "application/json" || mediaType === "text/event-stream" ? mediaType : "other";
      const rawLength = event.contentLength;
      const parsedLength = typeof rawLength === "string" && /^(0|[1-9][0-9]{0,8})$/.test(rawLength)
        ? Number(rawLength) : undefined;
      const contentLength = rawLength === undefined ? "missing"
        : parsedLength === undefined ? "invalid" : parsedLength <= 10_000_000 ? parsedLength : "over_limit";
      const transferEncoding = event.transferEncoding === undefined ? "missing"
        : event.transferEncoding.trim().toLowerCase() === "chunked" ? "chunked" : "other";
      this.providerLifecycle.push({ event: event.event, elapsedMs, status: event.status,
        upstreamRequestIdStatus, openrouterGenerationIdStatus, contentType, contentLength, transferEncoding,
        ...(upstreamRequestId ? { upstreamRequestId } : {}),
        ...(openrouterGenerationId ? { openrouterGenerationId } : {}) });
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
