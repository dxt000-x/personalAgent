import "server-only";
import { Pool } from "pg";
import { KnowledgeError } from "./errors";

// Only the dedicated LOGIN role may be used here. A postgres or service_role
// connection string must never silently acquire these privileges.
let pool: Pool | undefined;

function knowledgePool(): Pool {
  if (pool) return pool;
  const raw = process.env.KNOWLEDGE_DB_URL;
  if (!raw) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  try {
    const url = new URL(raw);
    const username = decodeURIComponent(url.username);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        !/^knowledge_writer_login(?:\.[a-zA-Z0-9_-]+)?$/u.test(username) ||
        !url.hostname || !url.password || !url.pathname.slice(1)) {
      throw new Error("Invalid knowledge database role");
    }
    pool = new Pool({ host: url.hostname, port: url.port ? Number(url.port) : 5432,
      user: username, password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)), max: 2,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: true } });
    return pool;
  } catch {
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
  try {
    const result = await knowledgePool().query(sql[operation], parameters);
    const value: unknown = result.rows[0]?.value;
    if (typeof value !== "boolean" && !(typeof value === "number" && Number.isSafeInteger(value))) {
      throw new Error("Unexpected transition result");
    }
    return value as T;
  } catch {
    // Never return a database error or connection string to the browser.
    throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  }
}

export async function assertKnowledgeWriterReady(): Promise<void> {
  if (!await callKnowledgeTransition<boolean>("ready", [])) {
    throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  }
}
