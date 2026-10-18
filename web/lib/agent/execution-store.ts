import "server-only";
import { X509Certificate } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { ExecutionAuthorization, VerifiedExecutionAuthorization } from "./execution-authorization";

export class ExecutionStoreError extends Error {
  constructor() { super("Agent execution store unavailable"); this.name = "ExecutionStoreError"; }
}

let pool: Pool | undefined;
type Check = "pass" | "fail" | "not_checked";
type Identity = "inferred_from_pooler_routing" | "not_verified";
export type ExecutionDbDiagnostic = {
  publicRefExpected: Check;
  writerRefMatchesPublic: Check;
  poolerConfig: Check;
  caConfig: Check;
  connection: Check;
  tlsVerification: Check;
  databaseName: Check;
  projectIdentity: Identity;
};

const expectedProjectRef = "pxfaqcepztzqyqtmbdrf";
let poolChecks: Pick<ExecutionDbDiagnostic, "publicRefExpected" | "writerRefMatchesPublic" | "poolerConfig" | "caConfig" | "tlsVerification"> | undefined;

function checkedConfig() {
  const checks = {
    publicRefExpected: "not_checked" as Check,
    writerRefMatchesPublic: "not_checked" as Check,
    poolerConfig: "not_checked" as Check,
    caConfig: "not_checked" as Check,
    tlsVerification: "not_checked" as Check,
  };
  try {
    const raw = process.env.AGENT_DB_URL;
    const encodedCa = process.env.AGENT_DB_CA_CERT_BASE64;
    const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!raw || !encodedCa || !publicUrl) return { checks };
    const url = new URL(raw);
    const publicProject = new URL(publicUrl);
    const ref = /^([a-z0-9]+)\.supabase\.co$/u.exec(publicProject.hostname)?.[1];
    checks.publicRefExpected = publicProject.protocol === "https:" && ref === expectedProjectRef ? "pass" : "fail";
    const user = decodeURIComponent(url.username);
    checks.writerRefMatchesPublic = ref && user === `agent_execution_writer_login.${ref}` ? "pass" : "fail";
    checks.poolerConfig = ["postgres:", "postgresql:"].includes(url.protocol)
      && /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.pooler\.supabase\.com$/u.test(url.hostname)
      && url.port === "6543" && url.pathname === "/postgres" && !!url.password
      && (url.search === "" || url.search === "?sslmode=require") && url.hash === "" ? "pass" : "fail";
    let ca: string;
    try {
      ca = Buffer.from(encodedCa, "base64").toString("utf8");
      new X509Certificate(ca);
      checks.caConfig = "pass";
    } catch {
      checks.caConfig = "fail";
      return { checks };
    }
    if (checks.writerRefMatchesPublic !== "pass" || checks.poolerConfig !== "pass" || !ref || publicProject.protocol !== "https:") return { checks };
    const options = { host: url.hostname, port: 6543, user,
      password: decodeURIComponent(url.password), database: "postgres", max: 2,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, query_timeout: 10000,
      ssl: { ca, servername: url.hostname, rejectUnauthorized: true } };
    checks.tlsVerification = "pass";
    return { checks, options };
  } catch {
    return { checks };
  }
}

function executionPool(validated?: ReturnType<typeof checkedConfig>): Pool {
  if (pool) return pool;
  try {
    const { checks, options } = validated ?? checkedConfig();
    if (!options) throw new ExecutionStoreError();
    const next = new Pool(options);
    next.on("error", () => undefined);
    poolChecks = checks;
    pool = next;
    return next;
  } catch {
    throw new ExecutionStoreError();
  }
}

export async function diagnoseExecutionDatabase(): Promise<ExecutionDbDiagnostic> {
  const validated = pool ? undefined : checkedConfig();
  const checks = poolChecks ?? validated!.checks;
  const result: ExecutionDbDiagnostic = { ...checks, connection: "not_checked",
    tlsVerification: "not_checked", databaseName: "not_checked", projectIdentity: "not_verified" };
  if (checks.publicRefExpected !== "pass" || checks.writerRefMatchesPublic !== "pass"
    || checks.poolerConfig !== "pass" || checks.caConfig !== "pass") return result;
  let client: PoolClient | undefined;
  try {
    client = await executionPool(validated).connect();
    result.connection = "pass";
    result.tlsVerification = "pass";
    const query = await client.query("SELECT current_database() AS name");
    result.databaseName = query.rows[0]?.name === "postgres" ? "pass" : "fail";
    if (result.databaseName === "pass" && result.tlsVerification === "pass") {
      result.projectIdentity = "inferred_from_pooler_routing";
    }
  } catch {
    if (!client) result.connection = "fail";
    else result.databaseName = "fail";
  } finally {
    client?.release();
  }
  return result;
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
