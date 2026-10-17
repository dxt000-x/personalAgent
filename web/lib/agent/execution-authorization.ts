import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AgentPlan } from "./planning";

const TOOL = "read_current_time";
const TTL_MS = 5 * 60 * 1000;
const CONFIRMED_TTL_MS = 30 * 1000;

type Authorization = { version: 1; userId: string; tool: typeof TOOL; phase: "plan" | "confirmed";
  planHash: string; expiresAt: number; nonce: string };

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
function issueAuthorization(userId: string, plan: AgentPlan, phase: Authorization["phase"]): string | null {
  const key = signingKey();
  if (!key) return null;
  const authorization: Authorization = {
    version: 1,
    userId,
    tool: TOOL,
    phase,
    planHash: planHash(plan),
    expiresAt: Date.now() + (phase === "confirmed" ? CONFIRMED_TTL_MS : TTL_MS),
    nonce: randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(authorization)).toString("base64url");
  return `${payload}.${signature(payload, key).toString("base64url")}`;
}

export function issuePlanAuthorization(userId: string, plan: AgentPlan): string | null {
  return issueAuthorization(userId, plan, "plan");
}

export function issueExecutionAuthorization(userId: string, plan: AgentPlan): string | null {
  return issueAuthorization(userId, plan, "confirmed");
}

export function verifyAuthorization(token: unknown, userId: string, phase: Authorization["phase"],
  plan?: AgentPlan): typeof TOOL | null {
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
      || typeof authorization.nonce !== "string" || !/^[A-Za-z0-9_-]{16,64}$/u.test(authorization.nonce)) return null;
    return TOOL;
  } catch {
    return null;
  }
}
