import "server-only";
import { AIGatewayError } from "./errors";

// Both AI route handlers declare maxDuration=30. Keep three seconds for response cleanup.
export const AI_REQUEST_DEADLINE_MS = 27_000;
export const MIN_CLOUD_START_MS = 2_000;
export const MIN_FALLBACK_WINDOW_MS = 4_000;
export type AbortOrigin = "client_abort" | "shared_deadline" | "provider_attempt_timeout" | "unknown";

/** One deadline for auth, Memory, routing, quota and all provider attempts. */
export class AIRequestDeadline {
  private readonly controller = new AbortController();
  private readonly startedAt: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private firstAbortOrigin?: AbortOrigin;
  private readonly onClientAbort = () => { this.firstAbortOrigin ??= "client_abort"; };
  private readonly onSharedAbort = () => { this.firstAbortOrigin ??= "shared_deadline"; };
  readonly signal: AbortSignal;

  constructor(
    readonly requestSignal: AbortSignal,
    private readonly budgetMs = AI_REQUEST_DEADLINE_MS,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.startedAt = now();
    this.signal = AbortSignal.any([requestSignal, this.controller.signal]);
    if (requestSignal.aborted) this.onClientAbort();
    requestSignal.addEventListener("abort", this.onClientAbort, { once: true });
    this.controller.signal.addEventListener("abort", this.onSharedAbort, { once: true });
    this.timer = setTimeout(() => this.controller.abort(), budgetMs);
  }

  remainingMs(): number {
    return Math.max(0, this.budgetMs - (this.now() - this.startedAt));
  }

  assertRemaining(minimumMs = 1): void {
    if (this.signal.aborted || this.remainingMs() < minimumMs) throw new AIGatewayError("TIMEOUT");
  }

  attemptSignal(maximumMs: number): AbortSignal {
    this.assertRemaining();
    const milliseconds = Math.max(1, Math.floor(Math.min(maximumMs, this.remainingMs())));
    return AbortSignal.any([this.signal, AbortSignal.timeout(milliseconds)]);
  }

  attemptSignals(
    maximumMs: number,
    createTimeoutSignal: (milliseconds: number) => AbortSignal = AbortSignal.timeout,
  ): { signal: AbortSignal; abortOrigin: () => AbortOrigin | undefined; close: () => void } {
    this.assertRemaining();
    const milliseconds = Math.max(1, Math.floor(Math.min(maximumMs, this.remainingMs())));
    const timeoutSignal = createTimeoutSignal(milliseconds);
    const signal = AbortSignal.any([this.signal, timeoutSignal]);
    let first: AbortOrigin | undefined;
    const onClient = () => { first ??= "client_abort"; };
    const onShared = () => { first ??= "shared_deadline"; };
    const onAttempt = () => { first ??= "provider_attempt_timeout"; };
    this.requestSignal.addEventListener("abort", onClient, { once: true });
    this.controller.signal.addEventListener("abort", onShared, { once: true });
    timeoutSignal.addEventListener("abort", onAttempt, { once: true });
    const close = () => {
      this.requestSignal.removeEventListener("abort", onClient);
      this.controller.signal.removeEventListener("abort", onShared);
      timeoutSignal.removeEventListener("abort", onAttempt);
    };
    if (timeoutSignal.aborted) onAttempt();
    return { signal, abortOrigin: () => first ?? (signal.aborted ? "unknown" : undefined), close };
  }

  get abortOrigin(): AbortOrigin | undefined {
    return this.firstAbortOrigin ?? (this.signal.aborted ? "unknown" : undefined);
  }

  /** Bounds waits whose underlying SDK may not expose cancellation. The shared signal still reaches cancellable I/O. */
  async wait<T>(operation: Promise<T>): Promise<T> {
    this.assertRemaining();
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new AIGatewayError("TIMEOUT"));
      this.signal.addEventListener("abort", onAbort, { once: true });
      operation.then(
        (value) => {
          this.signal.removeEventListener("abort", onAbort);
          try { this.assertRemaining(); resolve(value); } catch (error) { reject(error); }
        },
        (error) => {
          this.signal.removeEventListener("abort", onAbort);
          reject(this.signal.aborted || this.remainingMs() === 0 ? new AIGatewayError("TIMEOUT") : error);
        },
      );
    });
  }

  close(): void {
    clearTimeout(this.timer);
    this.requestSignal.removeEventListener("abort", this.onClientAbort);
    this.controller.signal.removeEventListener("abort", this.onSharedAbort);
  }
}
