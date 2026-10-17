import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AgentPlan } from "./planning";

const TOOL = "read_current_time";
const TTL_MS = 5 * 60 * 1000;
const CONFIRMED_TTL_MS = 30 * 1000;

type Authorization = { version: 1; userId: string; tool: typeof TOOL; phase: "plan" | "confirmed";
  planHash: string; expiresAt: number; jti: string };
export type ExecutionAuthorization = Readonly<{ token: string; jti: string; planHash: string; expiresAt: number }>;
export type VerifiedExecutionAuthorization = Readonly<{ tool: typeof TOOL; jti: string; planHash: string }>;

function planHash(plan: AgentPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function signingKey(): string | null {
  const key = process.env.AGENT_EXECUTION_SECRET;
  return key && key.length >= 32 ? key : null;
}

function signature(payload: string, key: string): Buffer {
  return createHmac("sha256", key).update(payload).digest();
}

/** A short-lived, user-bound capability. It never contains a client-selected handler. */
function issueAuthorization(userId: string, plan: AgentPlan, phase: Authorization["phase"]): ExecutionAuthorization | null {
  const key = signingKey();
  if (!key) return null;
  const authorization: Authorization = {
    version: 1,
    userId,
    tool: TOOL,
    phase,
    planHash: planHash(plan),
    expiresAt: Date.now() + (phase === "confirmed" ? CONFIRMED_TTL_MS : TTL_MS),
    jti: randomUUID(),
  };
  const payload = Buffer.from(JSON.stringify(authorization)).toString("base64url");
  return { token: `${payload}.${signature(payload, key).toString("base64url")}`,
    jti: authorization.jti, planHash: authorization.planHash, expiresAt: authorization.expiresAt };
}

export function issuePlanAuthorization(userId: string, plan: AgentPlan): string | null {
  return issueAuthorization(userId, plan, "plan")?.token ?? null;
}

export function issueExecutionAuthorization(userId: string, plan: AgentPlan): ExecutionAuthorization | null {
  return issueAuthorization(userId, plan, "confirmed");
}

function verifiedPayload(token: unknown, userId: string, phase: Authorization["phase"],
  plan?: AgentPlan): Authorization | null {
  if (phase === "plan" && !plan) return null;
  const key = signingKey();
  if (!key || typeof token !== "string" || token.length > 2048
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)) return null;
  const [payload, rawSignature] = token.split(".");
  const expected = signature(payload, key);
  const received = Buffer.from(rawSignature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const authorization = value as Partial<Authorization>;
    if (authorization.version !== 1 || authorization.userId !== userId || authorization.tool !== TOOL
      || authorization.phase !== phase
      || typeof authorization.planHash !== "string" || !/^[0-9a-f]{64}$/u.test(authorization.planHash)
      || (plan && authorization.planHash !== planHash(plan))
      || typeof authorization.expiresAt !== "number" || !Number.isSafeInteger(authorization.expiresAt)
      || authorization.expiresAt <= Date.now()
      || authorization.expiresAt > Date.now() + (phase === "confirmed" ? CONFIRMED_TTL_MS : TTL_MS)
      || typeof authorization.jti !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(authorization.jti)) return null;
    return authorization as Authorization;
  } catch {
    return null;
  }
}

export function verifyAuthorization(token: unknown, userId: string, phase: Authorization["phase"],
  plan?: AgentPlan): typeof TOOL | null {
  return verifiedPayload(token, userId, phase, plan)?.tool ?? null;
}

export function verifyExecutionAuthorization(token: unknown, userId: string): VerifiedExecutionAuthorization | null {
  const value = verifiedPayload(token, userId, "confirmed");
  return value ? { tool: value.tool, jti: value.jti, planHash: value.planHash } : null;
}
