// Explicit, isolated acceptance only. Reads process env; never loads .env.local.
import { randomBytes, randomUUID, X509Certificate } from "node:crypto";
import pg from "pg";

const REF = "pxfaqcepztzqyqtmbdrf";
const PROJECT = "personal-agent-quota-test";
const TOTAL_TIMEOUT_MS = 60000;
const CLEANUP_TIMEOUT_MS = 2000;
let stage = "CONFIG";
const clients = [];
const inTransaction = new Set();
const deadlineAt = Date.now() + TOTAL_TIMEOUT_MS;
let timedOut = false;
let cleanupFailed = false;
let deadlineTimer;

function assert(condition) {
  if (!condition) throw new Error("ACCEPTANCE_CHECK_FAILED");
}

function config() {
  assert(process.env.AGENT_DB_ACCEPTANCE_RUN === REF);
  assert(process.env.AGENT_DB_ACCEPTANCE_PROJECT_NAME === PROJECT);
  const publicUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  assert(publicUrl.protocol === "https:" && publicUrl.hostname === `${REF}.supabase.co`);
  const url = new URL(process.env.AGENT_DB_URL);
  const user = decodeURIComponent(url.username);
  assert(["postgres:", "postgresql:"].includes(url.protocol));
  assert(user === `agent_execution_writer_login.${REF}`);
  assert(/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.pooler\.supabase\.com$/u.test(url.hostname));
  assert(url.port === "6543" && url.pathname === "/postgres" && Boolean(url.password));
  assert((url.search === "" || url.search === "?sslmode=require") && url.hash === "");
  const encodedCa = process.env.AGENT_DB_CA_CERT_BASE64;
  assert(typeof encodedCa === "string" && encodedCa.length > 0);
  const ca = Buffer.from(encodedCa, "base64").toString("utf8");
  new X509Certificate(ca);
  return { host: url.hostname, port: 6543, user, password: decodeURIComponent(url.password),
    database: "postgres", ssl: { ca, servername: url.hostname, rejectUnauthorized: true },
    connectionTimeoutMillis: 5000, query_timeout: 10000 };
}

async function query(client, sql, values = []) {
  return client.query({ text: sql, values, query_timeout: 10000 });
}

function forceDisconnect(client) {
  // pg 8.23.1 has no public synchronous force-close API. Its own end() uses
  // this stream.destroy() path for an active non-pipeline query. Recheck on pg upgrades.
  try { client.connection?.stream?.destroy(); } catch { cleanupFailed = true; }
}

function assertWithinDeadline() {
  assert(!timedOut && Date.now() < deadlineAt);
}

async function withinCleanupBudget(operation) {
  const remaining = Math.min(CLEANUP_TIMEOUT_MS, deadlineAt - Date.now());
  if (remaining <= 0) throw new Error("CLEANUP_DEADLINE");
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("CLEANUP_TIMEOUT")), remaining);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const connection = config();
  assertWithinDeadline();
  stage = "CONNECT";
  for (let i = 0; i < 2; i += 1) {
    const client = new pg.Client(connection);
    client.on("error", () => { cleanupFailed = true; });
    clients.push(client);
    await client.connect();
    assert(client.connection.stream?.authorized === true);
    assertWithinDeadline();
  }
  stage = "ROLE";
  const roleChecks = await Promise.all(clients.map((client) => query(client,
    "select current_user as name, has_table_privilege(current_user, 'agent_private.execution_authorizations', 'SELECT,INSERT,UPDATE,DELETE') as table_access, has_function_privilege(current_user, 'agent_private.issue_execution_authorization(uuid,uuid,text,timestamptz)', 'EXECUTE') as issue_access, has_function_privilege(current_user, 'agent_private.consume_execution_authorization(uuid,uuid,text)', 'EXECUTE') as consume_access")));
  const [first, second] = roleChecks.map((result) => result.rows[0]);
  // The pooler login suffix selects the project; PostgreSQL current_user is the base role.
  assert(first.name === "agent_execution_writer_login" && second.name === first.name);
  assert(!first.table_access && !second.table_access);
  assert(first.issue_access && second.issue_access && first.consume_access && second.consume_access);
  assertWithinDeadline();

  const runId = randomUUID();
  const jti = randomUUID();
  const userId = randomUUID(); // Synthetic identifier, never a real account.
  const planHash = randomBytes(32).toString("hex");
  stage = "ISSUE";
  // Keep the exact synthetic JTI for read-only diagnosis if the issue call is uncertain.
  console.log(`RUN_ID=${runId}; JTI=${jti}; ISSUE_START`);
  const issue = await query(clients[0],
    "select agent_private.issue_execution_authorization($1::uuid,$2::uuid,$3::text,$4::timestamptz) as value",
    [userId, jti, planHash, new Date(Date.now() + 30000).toISOString()]);
  assert(issue.rows[0]?.value === true);
  assertWithinDeadline();
  console.log(`RUN_ID=${runId}; JTI=${jti}; ISSUE=PASS; TLS=PASS; ROLE=PASS`);

  stage = "CONSUME";
  for (const client of clients) {
    await query(client, "begin");
    inTransaction.add(client);
    // Server-side cancellation is needed: pg query_timeout only expires the client wait.
    await query(client, "set local statement_timeout = '8s'");
    assertWithinDeadline();
  }
  stage = "BACKEND_IDENTITY";
  // A transaction pooler pins each open transaction to its own backend.
  const backendChecks = await Promise.all(clients.map((client) => query(client,
    "select pg_backend_pid() as pid")));
  const [firstPid, secondPid] = backendChecks.map((result) => result.rows[0]?.pid);
  assert(Number.isInteger(firstPid) && Number.isInteger(secondPid) && firstPid !== secondPid);
  assertWithinDeadline();
  stage = "CONSUME";
  const consumeSql = "select agent_private.consume_execution_authorization($1::uuid,$2::uuid,$3::text) as value";
  const pending = clients.map((client, index) => query(client, consumeSql, [userId, jti, planHash])
    .then((result) => ({ index, value: result.rows[0]?.value })));
  const winner = await Promise.race(pending);
  assert(winner.value === "acquired");
  assertWithinDeadline();
  await query(clients[winner.index], "commit");
  inTransaction.delete(clients[winner.index]);
  assertWithinDeadline();
  const outcomes = await Promise.all(pending);
  for (const client of clients) {
    if (inTransaction.has(client)) {
      await query(client, "commit");
      inTransaction.delete(client);
    }
  }
  assertWithinDeadline();
  assert(outcomes.filter((item) => item.value === "acquired").length === 1);
  assert(outcomes.filter((item) => item.value === "replay").length === 1);

  stage = "FINISH";
  const finish = await query(clients[0],
    "select agent_private.finish_execution_authorization($1::uuid,$2::uuid,$3::boolean,$4::text) as value",
    [userId, jti, true, null]);
  assert(finish.rows[0]?.value === true);
  assertWithinDeadline();
  return { runId, jti };
}

const deadline = new Promise((_, reject) => {
  deadlineTimer = setTimeout(() => {
    timedOut = true;
    for (const client of clients) forceDisconnect(client);
    reject(new Error("TOTAL_TIMEOUT"));
  }, Math.max(0, deadlineAt - Date.now()));
});

let result;
try {
  result = await Promise.race([run(), deadline]);
} catch (error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : "SANITIZED";
  console.error(`AGENT_DB_ACCEPTANCE=FAIL; STAGE=${stage}; CODE=${timedOut ? "TOTAL_TIMEOUT" : code}`);
  process.exitCode = 1;
} finally {
  for (const client of clients) {
    if (inTransaction.has(client) && !timedOut) {
      try {
        await withinCleanupBudget(() => query(client, "rollback"));
        inTransaction.delete(client);
      } catch {
        cleanupFailed = true;
        forceDisconnect(client);
      }
    }
    if (timedOut || inTransaction.has(client)) forceDisconnect(client);
    try { await withinCleanupBudget(() => client.end()); }
    catch {
      cleanupFailed = true;
      forceDisconnect(client);
    }
  }
  clearTimeout(deadlineTimer);
  if (cleanupFailed || timedOut) process.exitCode = 1;
}
if (result && !timedOut && !cleanupFailed) {
  console.log(`RUN_ID=${result.runId}; JTI=${result.jti}; CONCURRENCY=PASS; FINISH=PASS; AUDIT_READ=NOT_RUN`);
} else if (cleanupFailed) {
  console.error("AGENT_DB_ACCEPTANCE=FAIL; STAGE=CLEANUP; CODE=SANITIZED");
}
