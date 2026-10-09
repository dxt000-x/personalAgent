// Run only against an isolated Supabase test project after its migration.
// Two short-lived authenticated JWTs and existing A/B document fixtures are
// required. This script does not log tokens or connection details.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

assert.equal(process.env.KB_TEST_PROJECT_KIND, "isolated-test-project", "Isolated test project flag required");
const required = ["KB_TEST_URL", "KB_TEST_PUBLISHABLE_KEY", "KB_TEST_JWT_A", "KB_TEST_JWT_B",
  "KB_TEST_DOC_A", "KB_TEST_DOC_B", "KB_TEST_PENDING_DOC_A", "KB_TEST_USER_A_ID"];
for (const key of required) assert.ok(process.env[key], `Missing ${key}`);

const url = process.env.KB_TEST_URL;
const key = process.env.KB_TEST_PUBLISHABLE_KEY;
const client = (jwt) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${jwt}` } },
});
const a = client(process.env.KB_TEST_JWT_A);
const b = client(process.env.KB_TEST_JWT_B);

const operations = [
  ["claim_knowledge_document", { p_document_id: process.env.KB_TEST_PENDING_DOC_A }],
  ["complete_knowledge_document", { p_document_id: process.env.KB_TEST_PENDING_DOC_A,
    p_generation: 1, p_chunks: ["unparsed client text"] }],
  ["fail_knowledge_document", { p_document_id: process.env.KB_TEST_PENDING_DOC_A,
    p_generation: 1, p_failure_kind: "temporary" }],
  ["mark_knowledge_deleting", { p_document_id: process.env.KB_TEST_PENDING_DOC_A }],
  ["finish_knowledge_deletion", { p_document_id: process.env.KB_TEST_PENDING_DOC_A }],
];

for (const [name, args] of operations) {
  for (const current of [a, b]) {
    const publicResult = await current.rpc(name, args);
    assert.ok(publicResult.error, `authenticated user unexpectedly executed public ${name}`);
    const privateResult = await current.schema("knowledge_private").rpc(name, {
      p_user_id: process.env.KB_TEST_USER_A_ID, ...args,
    });
    assert.ok(privateResult.error, `authenticated user unexpectedly executed private ${name}`);
  }
}

for (const [current, ownId, otherId] of [
  [a, process.env.KB_TEST_DOC_A, process.env.KB_TEST_DOC_B],
  [b, process.env.KB_TEST_DOC_B, process.env.KB_TEST_DOC_A],
]) {
  const own = await current.from("knowledge_documents").select("id").eq("id", ownId);
  assert.ifError(own.error);
  assert.equal(own.data.length, 1, "own fixture not visible");
  const other = await current.from("knowledge_documents").select("id").eq("id", otherId);
  assert.ifError(other.error);
  assert.equal(other.data.length, 0, "cross-user document visible");
  const otherChunks = await current.from("knowledge_chunks").select("document_id")
    .eq("document_id", otherId);
  assert.ifError(otherChunks.error);
  assert.equal(otherChunks.data.length, 0, "cross-user chunks visible");
}

console.log("Knowledge direct-RPC denial and A/B RLS checks passed in isolated test project.");
