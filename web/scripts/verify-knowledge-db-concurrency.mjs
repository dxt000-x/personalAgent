// Destructive acceptance test for a NEW, ISOLATED Supabase project/users.
// This file is never run by npm test. It opens independent PostgreSQL clients,
// writes test documents/Storage objects, and cleans up test fixtures.
// Never use a production URL or credential. No secrets or document text log.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Client } = pg;
assert.equal(process.env.KB_DB_TEST_PROJECT_KIND, "isolated-test-project");
assert.equal(process.env.KB_DB_TEST_ACK, "I_ACCEPT_MUTATING_ISOLATED_PROJECT");
const names = ["KB_DB_TEST_PROJECT_REF", "KB_DB_TEST_URL", "KB_DB_TEST_PUBLISHABLE_KEY",
  "KB_DB_TEST_JWT_A", "KB_DB_TEST_JWT_B", "KB_DB_TEST_USER_A_ID", "KB_DB_TEST_USER_B_ID",
  "KB_DB_TEST_WRITER_URL", "KB_DB_TEST_FIXTURE_ADMIN_URL", "KB_DB_TEST_CA_CERT_BASE64"];
for (const name of names) assert.ok(process.env[name], `Missing ${name}`);
const e = process.env;
const projectRef = e.KB_DB_TEST_PROJECT_REF;
assert.match(projectRef, /^[a-z0-9]+$/u);
assert.equal(new URL(e.KB_DB_TEST_URL).hostname, `${projectRef}.supabase.co`);
assert.notEqual(e.KB_DB_TEST_USER_A_ID, e.KB_DB_TEST_USER_B_ID);
const ca = Buffer.from(e.KB_DB_TEST_CA_CERT_BASE64, "base64").toString("utf8");
assert.ok(ca.includes("-----BEGIN CERTIFICATE-----") && ca.includes("-----END CERTIFICATE-----"));

function databaseConfig(raw, role) {
  const url = new URL(raw);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.port, "6543", "Use the shared Transaction Pooler");
  assert.equal(url.pathname, "/postgres");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  assert.match(url.hostname, /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/u);
  assert.equal(decodeURIComponent(url.username), `${role}.${projectRef}`);
  assert.ok(url.password);
  return {
    host: url.hostname, port: 6543, database: "postgres",
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    connectionTimeoutMillis: 5000, query_timeout: 15000,
    ssl: { ca, servername: url.hostname, rejectUnauthorized: true },
  };
}
const writerConfig = databaseConfig(e.KB_DB_TEST_WRITER_URL, "knowledge_writer_login");
const adminConfig = databaseConfig(e.KB_DB_TEST_FIXTURE_ADMIN_URL, "postgres");
const session = (jwt) => createClient(e.KB_DB_TEST_URL, e.KB_DB_TEST_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${jwt}` } },
});
const userA = session(e.KB_DB_TEST_JWT_A);
const userB = session(e.KB_DB_TEST_JWT_B);
const fixtures = [];
const clients = [];
const cleanupBlockedIds = new Set();
const source = Buffer.from("isolated database concurrency fixture");

async function connect(config) {
  const client = new Client(config);
  await client.connect();
  clients.push(client);
  return client;
}
async function scalar(client, sql, values) {
  const { rows } = await client.query(sql, values);
  return rows[0]?.value;
}
async function createDocument(client, userId, byteSize = 1, upload = false) {
  const id = randomUUID();
  const { data, error } = await client.from("knowledge_documents")
    .insert({ id, user_id: userId, file_name: `${id}.txt`, file_type: "txt", byte_size: byteSize })
    .select("id,storage_path").single();
  assert.ifError(error);
  assert.ok(data);
  const item = { id, userId, path: data.storage_path, upload };
  fixtures.push(item);
  if (upload) {
    const result = await client.storage.from("knowledge-files").upload(item.path, source,
      { contentType: "text/plain", upsert: false });
    assert.ifError(result.error);
  }
  return item;
}
async function expectInsertError(client, userId, byteSize, expected) {
  const { error } = await client.from("knowledge_documents").insert({
    id: randomUUID(), user_id: userId, file_name: "limit.txt",
    file_type: "txt", byte_size: byteSize,
  });
  assert.equal(error?.code, "P0001");
  assert.equal(error?.message, expected);
}
const claimSql = "select knowledge_private.claim_knowledge_document($1::uuid,$2::uuid) as value";
const failSql = "select knowledge_private.fail_knowledge_document($1::uuid,$2::uuid,$3::integer,$4::text) as value";
const completeSql = "select knowledge_private.complete_knowledge_document($1::uuid,$2::uuid,$3::integer,$4::jsonb) as value";
const markSql = "select knowledge_private.mark_knowledge_deleting($1::uuid,$2::uuid) as value";
const finishSql = "select knowledge_private.finish_knowledge_deletion($1::uuid,$2::uuid) as value";
const claim = (c, userId, id) => scalar(c, claimSql, [userId, id]);
const fail = (c, userId, id, generation) =>
  scalar(c, failSql, [userId, id, generation, "temporary"]);
const complete = (c, userId, id, generation) =>
  scalar(c, completeSql, [userId, id, generation, JSON.stringify(["verified test chunk"])]);
const mark = (c, userId, id) => scalar(c, markSql, [userId, id]);
const finish = (c, userId, id) => scalar(c, finishSql, [userId, id]);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function currentHourCount(admin, table, userId) {
  const { rows } = await admin.query(
    `select count(*)::integer as count from knowledge_private.${table}
      where user_id=$1 and created_at >= date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC'`,
    [userId],
  );
  return rows[0].count;
}
async function totalEventCount(admin, table, userId) {
  const { rows } = await admin.query(
    `select count(*)::integer as count from knowledge_private.${table} where user_id=$1`, [userId],
  );
  return rows[0].count;
}
async function shiftEvents(admin, table, userId) {
  // Fixture-only clock acceleration; it does not alter the production schema.
  await admin.query(
    `update knowledge_private.${table} set created_at=now()-interval '2 hours'
      where user_id=$1 and created_at >= date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC'`,
    [userId],
  );
}
async function documentCount(client) {
  const { count, error } = await client.from("knowledge_documents").select("id", { count: "exact", head: true });
  assert.ifError(error);
  return count;
}

let admin, first, second;
try {
  [admin, first, second] = await Promise.all([
    connect(adminConfig), connect(writerConfig), connect(writerConfig),
  ]);
  assert.equal(await totalEventCount(admin, "knowledge_upload_events", e.KB_DB_TEST_USER_A_ID), 0,
    "Use a fresh test user A");
  assert.equal(await totalEventCount(admin, "knowledge_upload_events", e.KB_DB_TEST_USER_B_ID), 0,
    "Use a fresh test user B");
  assert.equal(await totalEventCount(admin, "knowledge_process_events", e.KB_DB_TEST_USER_A_ID), 0);
  assert.equal(await totalEventCount(admin, "knowledge_process_events", e.KB_DB_TEST_USER_B_ID), 0);
  assert.equal(await documentCount(userA), 0, "Use an empty test user A");
  assert.equal(await documentCount(userB), 0, "Use an empty test user B");

  const race = await createDocument(userA, e.KB_DB_TEST_USER_A_ID, source.length, true);
  const stale = await createDocument(userA, e.KB_DB_TEST_USER_A_ID, source.length, true);
  const deleting = await createDocument(userA, e.KB_DB_TEST_USER_A_ID, source.length, true);
  const missing = await createDocument(userA, e.KB_DB_TEST_USER_A_ID, 1);
  assert.equal(await claim(first, e.KB_DB_TEST_USER_A_ID, missing.id), -1,
    "Missing Storage object must not be claimed");
  assert.equal(await claim(first, e.KB_DB_TEST_USER_B_ID, race.id), 0,
    "Another user's document must not be claimed");

  // Two real connections race while the first keeps its transaction open.
  await first.query("begin");
  let inTransaction = true;
  try {
    assert.equal(await claim(first, e.KB_DB_TEST_USER_A_ID, race.id), 1);
    const waiting = claim(second, e.KB_DB_TEST_USER_A_ID, race.id);
    await pause(150);
    await first.query("commit");
    inTransaction = false;
    assert.equal(await waiting, 0, "A second processor must not acquire the claim");
  } finally {
    if (inTransaction) await first.query("rollback");
  }
  assert.equal(await fail(first, e.KB_DB_TEST_USER_A_ID, race.id, 1), true);

  const oldGeneration = await claim(first, e.KB_DB_TEST_USER_A_ID, stale.id);
  assert.equal(oldGeneration, 1);
  await admin.query(
    "update public.knowledge_documents set updated_at=now()-interval '11 minutes' where id=$1 and user_id=$2 and status='processing'",
    [stale.id, e.KB_DB_TEST_USER_A_ID],
  );
  const newGeneration = await claim(second, e.KB_DB_TEST_USER_A_ID, stale.id);
  assert.equal(newGeneration, 2);
  assert.equal(await complete(first, e.KB_DB_TEST_USER_A_ID, stale.id, oldGeneration), false);
  assert.equal(await complete(second, e.KB_DB_TEST_USER_A_ID, stale.id, newGeneration), true);

  const deleteGeneration = await claim(first, e.KB_DB_TEST_USER_A_ID, deleting.id);
  await first.query("begin");
  inTransaction = true;
  try {
    assert.equal(await mark(first, e.KB_DB_TEST_USER_A_ID, deleting.id), true);
    const waiting = complete(second, e.KB_DB_TEST_USER_A_ID, deleting.id, deleteGeneration);
    await pause(150);
    await first.query("commit");
    inTransaction = false;
    assert.equal(await waiting, false, "Deletion must invalidate an older processor");
  } finally {
    if (inTransaction) await first.query("rollback");
  }
  assert.ifError((await userA.storage.from("knowledge-files").remove([deleting.path])).error);
  deleting.upload = false;
  assert.equal(await finish(first, e.KB_DB_TEST_USER_A_ID, deleting.id), true);

  // Hourly upload limit: first 20 allowed, 21st rejected, even with deletions.
  while (await currentHourCount(admin, "knowledge_upload_events", e.KB_DB_TEST_USER_A_ID) < 20) {
    await createDocument(userA, e.KB_DB_TEST_USER_A_ID);
  }
  await expectInsertError(userA, e.KB_DB_TEST_USER_A_ID, 1, "UPLOAD_RATE_LIMITED");

  // Move only this isolated user's fixture events to a previous UTC hour,
  // then build up to the 100-document and 100 MiB limits.
  while (await documentCount(userA) < 100) {
    if (await currentHourCount(admin, "knowledge_upload_events", e.KB_DB_TEST_USER_A_ID) >= 20) {
      await shiftEvents(admin, "knowledge_upload_events", e.KB_DB_TEST_USER_A_ID);
    }
    await createDocument(userA, e.KB_DB_TEST_USER_A_ID);
  }
  await shiftEvents(admin, "knowledge_upload_events", e.KB_DB_TEST_USER_A_ID);
  await expectInsertError(userA, e.KB_DB_TEST_USER_A_ID, 1, "KNOWLEDGE_LIMIT_REACHED");

  for (let index = 0; index < 25; index += 1) {
    if (await currentHourCount(admin, "knowledge_upload_events", e.KB_DB_TEST_USER_B_ID) >= 20) {
      await shiftEvents(admin, "knowledge_upload_events", e.KB_DB_TEST_USER_B_ID);
    }
    await createDocument(userB, e.KB_DB_TEST_USER_B_ID, 4194304);
  }
  await expectInsertError(userB, e.KB_DB_TEST_USER_B_ID, 1, "KNOWLEDGE_LIMIT_REACHED");

  await shiftEvents(admin, "knowledge_process_events", e.KB_DB_TEST_USER_A_ID);
  for (let index = 0; index < 60; index += 1) {
    const generation = await claim(first, e.KB_DB_TEST_USER_A_ID, race.id);
    assert.ok(Number.isInteger(generation) && generation > 0);
    assert.equal(await fail(first, e.KB_DB_TEST_USER_A_ID, race.id, generation), true);
  }
  assert.equal(await claim(second, e.KB_DB_TEST_USER_A_ID, race.id), -2,
    "61st processing claim in a UTC hour must be rejected");
  console.log("Isolated PostgreSQL claim, generation, delete, document, byte, and hourly limits passed.");
} finally {
  // Best-effort cleanup; test-only admin SQL deletes only IDs created here.
  for (const item of fixtures.filter((entry) => entry.upload)) {
    try {
      if (first) await mark(first, item.userId, item.id);
      const owner = item.userId === e.KB_DB_TEST_USER_A_ID ? userA : userB;
      const result = await owner.storage.from("knowledge-files").remove([item.path]);
      if (result.error) throw result.error;
    } catch { cleanupBlockedIds.add(item.id); }
  }
  if (admin && fixtures.length > 0) {
    try {
      await admin.query("delete from public.knowledge_documents where id=any($1::uuid[])",
        [fixtures.filter((item) => !cleanupBlockedIds.has(item.id)).map((item) => item.id)]);
      await admin.query("delete from knowledge_private.knowledge_upload_events where user_id=any($1::uuid[])",
        [[e.KB_DB_TEST_USER_A_ID, e.KB_DB_TEST_USER_B_ID]]);
      await admin.query("delete from knowledge_private.knowledge_process_events where user_id=any($1::uuid[])",
        [[e.KB_DB_TEST_USER_A_ID, e.KB_DB_TEST_USER_B_ID]]);
    } catch {
      console.error("Fixture cleanup needs manual review in the isolated project.");
    }
  }
  if (cleanupBlockedIds.size > 0) {
    console.error("Some Storage fixture cleanup failed; inspect the isolated project before reuse.");
  }
  await Promise.allSettled(clients.map((client) => client.end()));
}
