// Mutating checks for an isolated Supabase project only. Never log tokens,
// connection details, or file bytes.
import assert from "node:assert/strict";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

if (process.argv.length === 3 && process.argv[2] === "--interactive-storage") {
  const { runFromTerminal } = await import("./knowledge-storage-interactive.mjs");
  await runFromTerminal();
} else {
assert.equal(process.argv.length, 2, "Unsupported arguments");
const e = process.env;
assert.equal(e.KB_TEST_PROJECT_KIND, "isolated-test-project");
for (const name of ["KB_TEST_PROJECT_REF", "KB_TEST_URL", "KB_TEST_PUBLISHABLE_KEY",
  "KB_TEST_JWT_A", "KB_TEST_JWT_B", "KB_TEST_DOC_A", "KB_TEST_DOC_B",
  "KB_TEST_PENDING_DOC_A", "KB_TEST_PENDING_DOC_B", "KB_TEST_USER_A_ID",
  "KB_TEST_USER_B_ID", "KB_TEST_STORAGE_PATH_A", "KB_TEST_STORAGE_PATH_B",
  "KB_TEST_CLEANUP_WRITER_URL", "KB_TEST_CA_CERT_BASE64"]) {
  assert.ok(e[name], `Missing ${name}`);
}
assert.match(e.KB_TEST_PROJECT_REF, /^[a-z0-9]+$/u);
function parseUrl(raw) {
  try { return new URL(raw); }
  catch { throw new Error("Invalid isolated test URL"); }
}
assert.equal(parseUrl(e.KB_TEST_URL).hostname, `${e.KB_TEST_PROJECT_REF}.supabase.co`);
assert.notEqual(e.KB_TEST_USER_A_ID, e.KB_TEST_USER_B_ID);
const ca = Buffer.from(e.KB_TEST_CA_CERT_BASE64, "base64").toString("utf8");
assert.ok(ca.includes("-----BEGIN CERTIFICATE-----") && ca.includes("-----END CERTIFICATE-----"));
const writerUrl = parseUrl(e.KB_TEST_CLEANUP_WRITER_URL);
assert.equal(writerUrl.protocol, "postgresql:");
assert.equal(writerUrl.port, "6543");
assert.equal(writerUrl.pathname, "/postgres");
assert.equal(writerUrl.search, "");
assert.equal(writerUrl.hash, "");
assert.match(writerUrl.hostname, /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/u);
assert.equal(decodeURIComponent(writerUrl.username), `knowledge_writer_login.${e.KB_TEST_PROJECT_REF}`);
assert.ok(writerUrl.password);

const session = (jwt) => createClient(e.KB_TEST_URL, e.KB_TEST_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${jwt}` } },
});
const a = session(e.KB_TEST_JWT_A);
const b = session(e.KB_TEST_JWT_B);
const bucket = (client) => client.storage.from("knowledge-files");
const pendingPath = `${e.KB_TEST_USER_B_ID}/${e.KB_TEST_PENDING_DOC_B}/source.txt`;
let temporaryObjectExists = false;

async function ownOriginal(client, path) {
  const result = await bucket(client).download(path);
  assert.ifError(result.error);
  assert.ok(result.data && result.data.size > 0, "own original fixture is absent or empty");
}

async function cleanupUnexpectedUpload() {
  if (!temporaryObjectExists) return;
  // A cannot remove B's object. A restricted writer changes only this pending
  // fixture to deleting; B then removes its own object under Storage RLS.
  const writer = new pg.Client({
    host: writerUrl.hostname, port: 6543, database: "postgres",
    user: decodeURIComponent(writerUrl.username), password: decodeURIComponent(writerUrl.password),
    connectionTimeoutMillis: 5000, query_timeout: 15000,
    ssl: { ca, servername: writerUrl.hostname, rejectUnauthorized: true },
  });
  try {
    await writer.connect();
    const marked = await writer.query(
      "select knowledge_private.mark_knowledge_deleting($1::uuid,$2::uuid) as value",
      [e.KB_TEST_USER_B_ID, e.KB_TEST_PENDING_DOC_B],
    );
    assert.equal(marked.rows[0]?.value, true);
    assert.ifError((await bucket(b).remove([pendingPath])).error);
    const finished = await writer.query(
      "select knowledge_private.finish_knowledge_deletion($1::uuid,$2::uuid) as value",
      [e.KB_TEST_USER_B_ID, e.KB_TEST_PENDING_DOC_B],
    );
    assert.equal(finished.rows[0]?.value, true);
    assert.ok((await bucket(b).download(pendingPath)).error);
    temporaryObjectExists = false;
  } finally {
    await writer.end().catch(() => undefined);
  }
}

async function main() {
  for (const [client, jwt, userId] of [
    [a, e.KB_TEST_JWT_A, e.KB_TEST_USER_A_ID], [b, e.KB_TEST_JWT_B, e.KB_TEST_USER_B_ID],
  ]) {
    const identity = await client.auth.getUser(jwt);
    assert.ifError(identity.error);
    assert.equal(identity.data.user?.id, userId, "JWT identity does not match fixture");
  }

  // A negative cross-user check is meaningful only after the owner can read
  // the exact document and nonempty Storage object named by the fixture.
  for (const [client, ownId, otherId, ownPath] of [
    [a, e.KB_TEST_DOC_A, e.KB_TEST_DOC_B, e.KB_TEST_STORAGE_PATH_A],
    [b, e.KB_TEST_DOC_B, e.KB_TEST_DOC_A, e.KB_TEST_STORAGE_PATH_B],
  ]) {
    const own = await client.from("knowledge_documents").select("id,storage_path")
      .eq("id", ownId).single();
    assert.ifError(own.error);
    assert.equal(own.data?.storage_path, ownPath, "original path differs from fixture");
    await ownOriginal(client, ownPath);
    const other = await client.from("knowledge_documents").select("id").eq("id", otherId);
    assert.ifError(other.error);
    assert.equal(other.data.length, 0, "cross-user document visible");
    const chunks = await client.from("knowledge_chunks").select("document_id").eq("document_id", otherId);
    assert.ifError(chunks.error);
    assert.equal(chunks.data.length, 0, "cross-user chunks visible");
  }
  const pending = await b.from("knowledge_documents").select("id,storage_path,status")
    .eq("id", e.KB_TEST_PENDING_DOC_B).single();
  assert.ifError(pending.error);
  assert.equal(pending.data?.status, "uploading");
  assert.equal(pending.data?.storage_path, pendingPath);
  assert.ok((await bucket(b).download(pendingPath)).error, "pending object already exists");
  const pendingA = await a.from("knowledge_documents").select("id,status")
    .eq("id", e.KB_TEST_PENDING_DOC_A).single();
  assert.ifError(pendingA.error);
  assert.equal(pendingA.data?.status, "uploading");

  const operations = [
    ["claim_knowledge_document", { p_document_id: e.KB_TEST_PENDING_DOC_A }],
    ["complete_knowledge_document", { p_document_id: e.KB_TEST_PENDING_DOC_A,
      p_generation: 1, p_chunks: ["unparsed client text"] }],
    ["fail_knowledge_document", { p_document_id: e.KB_TEST_PENDING_DOC_A,
      p_generation: 1, p_failure_kind: "temporary" }],
    ["mark_knowledge_deleting", { p_document_id: e.KB_TEST_PENDING_DOC_A }],
    ["finish_knowledge_deletion", { p_document_id: e.KB_TEST_PENDING_DOC_A }],
  ];
  for (const [name, args] of operations) {
    for (const client of [a, b]) {
      assert.ok((await client.rpc(name, args)).error, `public ${name} was callable`);
      assert.ok((await client.schema("knowledge_private").rpc(name, {
        p_user_id: e.KB_TEST_USER_A_ID, ...args,
      })).error, `private ${name} was callable`);
    }
  }
  for (const [client, path] of [[a, e.KB_TEST_STORAGE_PATH_B], [b, e.KB_TEST_STORAGE_PATH_A]]) {
    assert.ok((await bucket(client).download(path)).error, "cross-user download succeeded");
    const listed = await bucket(client).list(path.split("/")[0]);
    assert.ok(listed.error || !listed.data?.some((item) => item.name === path.split("/")[1]),
      "cross-user listing succeeded");
  }

  // Storage may report an empty successful remove for an invisible object.
  // The owner's follow-up download proves the original survived.
  await bucket(a).remove([e.KB_TEST_STORAGE_PATH_B]);
  await ownOriginal(b, e.KB_TEST_STORAGE_PATH_B);

  const upload = await bucket(a).upload(pendingPath, new TextEncoder().encode("isolated test"),
    { contentType: "text/plain", upsert: false });
  const observed = await bucket(b).download(pendingPath);
  temporaryObjectExists = !upload.error || !observed.error;
  assert.ok(upload.error && observed.error, "cross-user upload succeeded");
}

let passed = false;
try {
  await main();
  passed = true;
} catch {
  console.error("Knowledge security check failed; inspect isolated fixture policies.");
  process.exitCode = 1;
} finally {
  try { await cleanupUnexpectedUpload(); }
  catch {
    console.error("Temporary object cleanup failed; inspect isolated project before reuse.");
    process.exitCode = 1;
  }
}
if (passed && !process.exitCode) {
  console.log("Knowledge direct-RPC and A/B Storage isolation checks passed in isolated test project.");
}
}
