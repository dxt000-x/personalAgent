// Run only after the reviewed migration is installed in an isolated Supabase test project.
// Use two fresh test users on each run. Tokens and keys are read from process env and never printed.
import assert from "node:assert/strict";

const required = [
  "AI_QUOTA_TEST_SUPABASE_URL",
  "AI_QUOTA_TEST_PUBLISHABLE_KEY",
  "AI_QUOTA_TEST_USER_A_JWT",
  "AI_QUOTA_TEST_USER_B_JWT",
];
if (process.env.AI_QUOTA_TEST_PROJECT_KIND !== "isolated-test-project"
  || required.some((name) => !process.env[name])) {
  throw new Error("Set the isolated-test-project guard and all AI_QUOTA_TEST_* variables before running.");
}

const url = process.env.AI_QUOTA_TEST_SUPABASE_URL.replace(/\/$/, "");
const key = process.env.AI_QUOTA_TEST_PUBLISHABLE_KEY;
const userA = process.env.AI_QUOTA_TEST_USER_A_JWT;
const userB = process.env.AI_QUOTA_TEST_USER_B_JWT;

function claims(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("A test JWT could not be parsed.");
  }
}

const a = claims(userA);
const b = claims(userB);
assert.equal(a.role, "authenticated");
assert.equal(b.role, "authenticated");
assert.ok(a.sub && b.sub && a.sub !== b.sub, "Use two distinct test users.");

const now = Date.now();
const nextMidnight = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`) + 86_400_000;
assert.ok(nextMidnight - now > 120_000, "Run at least two minutes before UTC midnight.");
const expectedDate = new Date(now).toISOString().slice(0, 10);

async function reserve(token) {
  const response = await fetch(`${url}/rest/v1/rpc/reserve_cloud_ai_quota`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Quota RPC returned HTTP ${response.status}.`);
  const rows = await response.json();
  assert.ok(Array.isArray(rows) && rows.length === 1, "Quota RPC must return exactly one row.");
  const row = rows[0];
  assert.equal(row.usage_date, expectedDate);
  assert.equal(Date.parse(row.reset_at), nextMidnight);
  assert.equal(typeof row.allowed, "boolean");
  assert.ok(Number.isInteger(row.remaining_count));
  return row;
}

async function expectDeniedDirectTable(token) {
  for (const method of ["GET", "PATCH"]) {
    const response = await fetch(`${url}/rest/v1/ai_daily_usage?user_id=eq.${a.sub}&select=used_count`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        ...(method === "PATCH" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "PATCH" ? { body: JSON.stringify({ used_count: 0 }) } : {}),
      cache: "no-store",
    });
    assert.ok(response.status === 401 || response.status === 403, `Direct table ${method} must be denied.`);
  }
}

await expectDeniedDirectTable(userA);
const anonymous = await fetch(`${url}/rest/v1/rpc/reserve_cloud_ai_quota`, {
  method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: "{}", cache: "no-store",
});
assert.ok(anonymous.status === 401 || anonymous.status === 403, "Anonymous RPC must be denied.");

const results = await Promise.all(Array.from({ length: 40 }, () => reserve(userA)));
const allowed = results.filter((result) => result.allowed);
const denied = results.filter((result) => !result.allowed);
assert.equal(allowed.length, 30, "Exactly 30 concurrent reservations must be allowed.");
assert.equal(denied.length, 10, "The other 10 concurrent reservations must be denied.");
assert.deepEqual(allowed.map((result) => result.remaining_count).sort((left, right) => left - right),
  Array.from({ length: 30 }, (_, index) => index));
assert.ok(denied.every((result) => result.remaining_count === 0));
assert.equal((await reserve(userA)).allowed, false, "The 41st call must remain denied.");

const bFirst = await reserve(userB);
assert.equal(bFirst.allowed, true, "User B must have an independent allowance.");
assert.equal(bFirst.remaining_count, 29);

console.log("Quota database acceptance passed: 30 allowed, 10 denied, user isolation and access restrictions verified.");
