import "server-only";
import { Pool, type PoolClient } from "pg";
import { KnowledgeError } from "./errors";

// Only the dedicated LOGIN role may be used here. A postgres or service_role
// connection string must never silently acquire these privileges.
let pool: Pool | undefined;

const safeConnectionCodes = new Set([
  "28P01", "28000", "08001", "08004", "08006", "53300",
  "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
  "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

function writerConnectionDiagnostics(error: unknown) {
  // pg/Node error messages can contain connection details. Log only canonical
  // descriptions and allowlisted codes, never the original Error object.
  const message = error instanceof Error ? error.message : "";
  const rawCode = error !== null && typeof error === "object" && "code" in error
    ? error.code : undefined;
  const errorCode = typeof rawCode === "string" && safeConnectionCodes.has(rawCode)
    ? rawCode : "UNKNOWN";
  const passwordAuthFailed = /password authentication failed/iu.test(message);
  const tlsCertificateError = /(?:certificate|self.signed|unable to verify|tls|ssl)/iu.test(message) ||
    errorCode.startsWith("ERR_TLS_") || errorCode.includes("CERT") ||
    errorCode === "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
  const errorMessage = passwordAuthFailed ? "password authentication failed"
    : tlsCertificateError ? "TLS or certificate validation failed"
      : errorCode === "ENOTFOUND" ? "DNS lookup failed"
        : errorCode === "ECONNREFUSED" ? "connection refused"
          : errorCode === "ECONNRESET" ? "connection reset"
            : errorCode === "ETIMEDOUT" ? "connection timed out" : "connection failed";
  return {
    error_name: error instanceof Error && ["Error", "TypeError", "DatabaseError", "AggregateError"].includes(error.name)
      ? error.name : "UnknownError",
    error_message: errorMessage,
    error_code: errorCode,
    password_authentication_failed: passwordAuthFailed,
    tls_certificate_error: tlsCertificateError,
    hostname: "***.pooler.supabase.com",
    port: 6543,
    database_name: "postgres",
  };
}

function knowledgePool(): Pool {
  if (pool) return pool;
  const raw = process.env.KNOWLEDGE_DB_URL;
  const certificate = process.env.KNOWLEDGE_DB_CA_CERT_BASE64;
  if (!raw || !certificate) {
    console.error("WRITER_CONFIG_FAIL");
    throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  }
  try {
    const url = new URL(raw);
    const username = decodeURIComponent(url.username);
    const ca = Buffer.from(certificate, "base64").toString("utf8");
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        !/^knowledge_writer_login\.[a-zA-Z0-9_-]+$/u.test(username) ||
        !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.pooler\.supabase\.com$/u.test(url.hostname) ||
        url.port !== "6543" || url.pathname !== "/postgres" ||
        url.search !== "" || url.hash !== "" || !url.password ||
        !ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
      throw new Error("Invalid knowledge database role");
    }
    const nextPool = new Pool({ host: url.hostname, port: 6543,
      user: username, password: decodeURIComponent(url.password),
      database: "postgres", max: 2, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, query_timeout: 10000,
      ssl: { ca, servername: url.hostname, rejectUnauthorized: true } });
    // Serverless instances can resume with stale idle sockets. Keep an error
    // listener so their raw connection errors never become unhandled logs.
    nextPool.on("error", () => undefined);
    pool = nextPool;
    return pool;
  } catch {
    console.error("WRITER_CONFIG_FAIL");
    throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  }
}

type Operation = "ready" | "claim" | "complete" | "fail" | "markDeleting" | "finishDeleting";
const sql: Record<Operation, string> = {
  ready: "select has_function_privilege(current_user, to_regprocedure('knowledge_private.complete_knowledge_document(uuid,uuid,integer,jsonb)'), 'EXECUTE') as value",
  claim: "select knowledge_private.claim_knowledge_document($1::uuid, $2::uuid) as value",
  complete: "select knowledge_private.complete_knowledge_document($1::uuid, $2::uuid, $3::integer, $4::jsonb) as value",
  fail: "select knowledge_private.fail_knowledge_document($1::uuid, $2::uuid, $3::integer, $4::text) as value",
  markDeleting: "select knowledge_private.mark_knowledge_deleting($1::uuid, $2::uuid) as value",
  finishDeleting: "select knowledge_private.finish_knowledge_deletion($1::uuid, $2::uuid) as value",
};

export async function callKnowledgeTransition<T extends boolean | number>(
  operation: Operation, parameters: unknown[],
): Promise<T> {
  const debugOperation = operation === "claim" || operation === "complete" || operation === "fail";
  if (debugOperation) console.info(`[knowledge-debug] ${operation}:start`);
  try {
    const result = await knowledgePool().query(sql[operation], parameters);
    const value: unknown = result.rows[0]?.value;
    if (typeof value !== "boolean" && !(typeof value === "number" && Number.isSafeInteger(value))) {
      throw new Error("Unexpected transition result");
    }
    if (debugOperation) console.info(`[knowledge-debug] ${operation}:result`, { value });
    return value as T;
  } catch {
    if (debugOperation) console.error(`[knowledge-debug] ${operation}:error`);
    // Never return a database error or connection string to the browser.
    throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  }
}

export async function assertKnowledgeWriterReady(): Promise<void> {
  let client: PoolClient;
  try {
    client = await knowledgePool().connect();
  } catch (error) {
    if (!(error instanceof KnowledgeError)) {
      console.error("WRITER_CONNECT_FAIL", writerConnectionDiagnostics(error));
    }
    throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  }
  try {
    const result = await client.query(sql.ready);
    if (result.rows[0]?.value !== true) {
      console.error("WRITER_PRIVILEGE_FAIL");
      throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    }
    console.info("WRITER_READY_OK");
  } catch (error) {
    if (!(error instanceof KnowledgeError)) console.error("WRITER_PRIVILEGE_FAIL");
    throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  } finally {
    client.release();
  }
}
