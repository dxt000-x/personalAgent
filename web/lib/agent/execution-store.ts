import "server-only";
import { X509Certificate } from "node:crypto";
import { Pool } from "pg";
import type { ExecutionAuthorization, VerifiedExecutionAuthorization } from "./execution-authorization";

export class ExecutionStoreError extends Error {
  constructor() { super("Agent execution store unavailable"); this.name = "ExecutionStoreError"; }
}

let pool: Pool | undefined;

function executionPool(): Pool {
  if (pool) return pool;
  try {
    const raw = process.env.AGENT_DB_URL;
    const encodedCa = process.env.AGENT_DB_CA_CERT_BASE64;
    const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!raw || !encodedCa || !publicUrl) throw new ExecutionStoreError();
    const url = new URL(raw);
    const publicProject = new URL(publicUrl);
    const ref = /^([a-z0-9]+)\.supabase\.co$/u.exec(publicProject.hostname)?.[1];
    const ca = Buffer.from(encodedCa, "base64").toString("utf8");
    new X509Certificate(ca);
    const user = decodeURIComponent(url.username);
    if (!ref || publicProject.protocol !== "https:" || !["postgres:", "postgresql:"].includes(url.protocol)
      || user !== `agent_execution_writer_login.${ref}`
      || !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.pooler\.supabase\.com$/u.test(url.hostname)
      || url.port !== "6543" || url.pathname !== "/postgres" || !url.password
      || (url.search !== "" && url.search !== "?sslmode=require") || url.hash !== "") {
      throw new ExecutionStoreError();
    }
    const next = new Pool({ host: url.hostname, port: 6543, user,
      password: decodeURIComponent(url.password), database: "postgres", max: 2,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, query_timeout: 10000,
      ssl: { ca, servername: url.hostname, rejectUnauthorized: true } });
    next.on("error", () => undefined);
    pool = next;
    return next;
  } catch {
    throw new ExecutionStoreError();
  }
}

async function call(sql: string, values: unknown[]): Promise<unknown> {
  try {
    const result = await executionPool().query(sql, values);
    return result.rows[0]?.value;
  } catch {
    // Never return a PostgreSQL error, URL or certificate to the API caller.
    throw new ExecutionStoreError();
  }
}

export async function persistExecutionAuthorization(userId: string,
  authorization: Omit<ExecutionAuthorization, "token">): Promise<void> {
  const value = await call("select agent_private.issue_execution_authorization($1::uuid, $2::uuid, $3::text, $4::timestamptz) as value",
    [userId, authorization.jti, authorization.planHash, new Date(authorization.expiresAt).toISOString()]);
  if (value !== true) throw new ExecutionStoreError();
}

export async function consumeExecutionAuthorization(userId: string, authorization: VerifiedExecutionAuthorization): Promise<"acquired" | "replay" | "missing"> {
  const value = await call("select agent_private.consume_execution_authorization($1::uuid, $2::uuid, $3::text) as value",
    [userId, authorization.jti, authorization.planHash]);
  if (value !== "acquired" && value !== "replay" && value !== "missing") throw new ExecutionStoreError();
  return value;
}

export async function finishExecutionAuthorization(userId: string, jti: string,
  succeeded: boolean, errorCode: "TOOL_FAILED" | "AUDIT_UNAVAILABLE" | null): Promise<void> {
  const value = await call("select agent_private.finish_execution_authorization($1::uuid, $2::uuid, $3::boolean, $4::text) as value",
    [userId, jti, succeeded, errorCode]);
  if (value !== true) throw new ExecutionStoreError();
}
