import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(resolve(process.cwd(), "scripts/agent-execution-http-acceptance.js"), "utf8");
const jtis = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const plan = { version: 1, goal: "fixture goal", steps: [], requiresConfirmation: true };
const tokenFor = (jti) => `${Buffer.from(JSON.stringify({ jti, phase: "confirmed", secret: "fixture-secret" }))
  .toString("base64url")}.${Buffer.alloc(32, 7).toString("base64url")}`;

async function runAcceptance(concurrentJti = jtis[1], mode = "full") {
  const tokens = [tokenFor(jtis[0]), tokenFor(concurrentJti), tokenFor(jtis[2])];
  const rows = [];
  const executeBodies = [];
  const requestPaths = [];
  const planBodies = [];
  const consumed = new Set();
  let plans = 0;
  let confirms = 0;
  let toolExecutions = 0;
  const respond = (status, body) => ({ status, ok: status < 400, json: async () => body });
  const fetch = async (path, options) => {
    requestPaths.push(path);
    if (path === "/api/ai/providers") return respond(200, [{ id: "openrouter", configured: true, model: "openrouter/free" }]);
    const body = JSON.parse(options.body);
    if (path === "/api/agent/plan") {
      plans += 1;
      planBodies.push(body);
      return respond(200, { plan, planAuthorization: `fixture-plan-authorization-${plans}`,
        private: "fixture-secret" });
    }
    if (path === "/api/agent/confirm") {
      if (body.plan.goal !== plan.goal) return respond(400, { error: { code: "INVALID_REQUEST" } });
      return respond(200, { authorization: tokens[confirms++], private: "fixture-secret" });
    }
    if (path === "/api/agent/execute") {
      executeBodies.push(body);
      if (!tokens.includes(body.authorization)) return respond(400, { error: { code: "INVALID_REQUEST" } });
      if (body.authorization === tokens[2]) return respond(400, { error: { code: "INVALID_REQUEST" } });
      if (consumed.has(body.authorization)) return respond(409, { error: { code: "REPLAY_REJECTED" } });
      consumed.add(body.authorization);
      toolExecutions += 1;
      return respond(200, { result: { tool: "read_current_time", ok: true,
        data: { iso: "2026-10-19T00:00:00.000Z" } } });
    }
    throw new Error("unexpected test request");
  };
  const result = runInNewContext(script, {
    fetch, atob, Date, Promise, JSON, Uint8Array, location: {
      origin: "http://localhost:3110", protocol: "http:", hostname: "localhost", pathname: "/agent",
    },
    window: { __agentExecutionAcceptanceMode: mode, confirm: () => true },
    setTimeout: (callback) => { callback(); return 1; },
    console: { table: (value) => { rows.push(...value); } },
  }, { timeout: 1000 });
  await Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error("test timeout")), 2000))]);
  return { rows, executeBodies, tokens, requestPaths, planBodies, plans, confirms, toolExecutions };
}

describe("Agent HTTP acceptance audit correlation", () => {
  it("rejects an unsupported mode without making any request", async () => {
    const { rows, requestPaths } = await runAcceptance(jtis[1], "replayOnly");
    expect(requestPaths).toEqual([]);
    expect(rows.find((row) => row.scenario === "mode_gate")).toMatchObject({
      http: "NOT RUN", detail: "unsupported_mode",
    });
  });

  it("runs only one Auto-routed Plan, Confirm and same-authorization replay in replay-only mode", async () => {
    const { rows, executeBodies, tokens, requestPaths, planBodies, plans, confirms, toolExecutions } =
      await runAcceptance(jtis[1], "replay-only");
    expect(plans).toBe(1);
    expect(confirms).toBe(1);
    expect(toolExecutions).toBe(1);
    expect(planBodies).toHaveLength(1);
    expect(planBodies[0]).toMatchObject({ provider: "auto", routingPreference: "auto" });
    expect(requestPaths).toEqual(["/api/agent/plan", "/api/agent/confirm",
      "/api/agent/execute", "/api/agent/execute"]);
    expect(executeBodies).toEqual([{ authorization: tokens[0] }, { authorization: tokens[0] }]);
    expect(rows.find((row) => row.scenario === "replay_execute_first")).toMatchObject({
      http: 200, detail: "tool_ok=true; iso_valid=true",
    });
    expect(rows.find((row) => row.scenario === "replay_execute_second")).toMatchObject({
      http: 409, code: "REPLAY_REJECTED", detail: "rejected_without_result",
    });
    expect(rows.find((row) => row.scenario === "replay_audit")).toMatchObject({
      detail: `jti=${jtis[0]}; http=200,409; code=none,REPLAY_REJECTED; verdict=PASS`,
    });
    expect(rows.some((row) => /^(?:tampered|forged|concurrent|expired|cross_user)/u.test(row.scenario))).toBe(false);
    const output = JSON.stringify(rows);
    for (const token of tokens) expect(output).not.toContain(token);
    expect(output).not.toMatch(/fixture-secret|fixture goal|fixture-plan-authorization|private/);
  });

  it("reports the exact concurrent JTI and both results without exposing authorization or response data", async () => {
    const { rows, executeBodies, tokens } = await runAcceptance();
    expect(rows.map((row) => row.scenario)).toContain("concurrent_audit");
    const audit = rows.find((row) => row.scenario === "concurrent_audit");
    expect(audit).toMatchObject({ http: "CHECK", code: "",
      detail: `jti=${jtis[1]}; http=200,409; code=none,REPLAY_REJECTED; verdict=PASS` });
    expect(executeBodies.filter((body) => body.authorization === tokens[1])).toHaveLength(2);
    const output = JSON.stringify(rows);
    for (const token of tokens) expect(output).not.toContain(token);
    expect(output).not.toMatch(/fixture-secret|fixture goal|fixture-plan-authorization|private/);
  });

  it("does not execute the concurrent pair when its signed payload has no valid JTI", async () => {
    const { rows, executeBodies, tokens } = await runAcceptance("not-a-uuid");
    expect(rows.map((row) => row.scenario)).toContain("concurrent_audit");
    expect(rows.find((row) => row.scenario === "concurrent_audit")).toMatchObject({
      http: "NOT RUN", detail: "signed_authorization_jti_unavailable",
    });
    expect(executeBodies.some((body) => body.authorization === tokens[1])).toBe(false);
    expect(JSON.stringify(rows)).not.toContain(tokens[1]);
  });
});
