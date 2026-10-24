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
  const confirmations = [];
  const consumed = new Set();
  let plans = 0;
  let confirms = 0;
  let toolExecutions = 0;
  let expired = false;
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
      if (mode === "security-expiry" && expired) return respond(400, { error: { code: "INVALID_REQUEST" } });
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
    window: { __agentExecutionAcceptanceMode: mode, confirm: (message) => { confirmations.push(message); return true; } },
    setTimeout: (callback, delay) => { if (delay === 32000) expired = true; callback(); return 1; },
    console: { table: (value) => { rows.push(...value); } },
  }, { timeout: 1000 });
  await Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error("test timeout")), 2000))]);
  return { rows, executeBodies, tokens, requestPaths, planBodies, plans, confirms, toolExecutions, confirmations };
}

describe("Agent HTTP acceptance audit correlation", () => {
  it.each([
    ["no_message", null, "message_timeout_after_listener_registered"],
    ["wrong_window", "source", "window_reference_mismatch"],
    ["wrong_origin", "origin", "origin_mismatch"],
    ["wrong_kind", "kind", "message_type_mismatch"],
  ])("rejects B handoff %s with a fixed stage reason", async (_case, fault, reason) => {
    const bOrigin = "https://personal-agent-abcd1234-dxt000-x.vercel.app";
    const aOrigin = "https://personal-agent-git-feat-agent-planning-mvp-dxt000-x.vercel.app";
    const rows = [];
    const listeners = new Set();
    const opener = { postMessage: () => undefined };
    let timer;
    const task = runInNewContext(script, {
      atob, Date, Promise, JSON, Uint8Array, URL,
      location: { origin: bOrigin, protocol: "https:", hostname: new URL(bOrigin).hostname, pathname: "/agent" },
      window: { __agentExecutionAcceptanceMode: "security-cross-user-b", opener, confirm: () => true,
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener) },
      setTimeout: (callback) => { timer = callback; return 1; }, clearTimeout: () => undefined,
      fetch: () => { throw new Error("unexpected request"); },
      console: { table: (value) => rows.push(...value) },
    });
    if (fault) {
      for (const listener of listeners) listener({
        source: fault === "source" ? {} : opener,
        origin: fault === "origin" ? "https://untrusted.invalid" : aOrigin,
        data: { kind: fault === "kind" ? "other" : "agent-cross-user-authorization" },
      });
    }
    timer();
    await task;
    expect(rows.find((row) => row.scenario === "cross_user_b")).toMatchObject({
      http: "NOT RUN", detail: `authorization_not_received:${reason}`,
    });
    expect(rows.some((row) => row.scenario === "cross_user_b_execute")).toBe(false);
  });

  it("distinguishes an unacknowledged authorization from a missing B result", async () => {
    const aOrigin = "https://personal-agent-git-feat-agent-planning-mvp-dxt000-x.vercel.app";
    const bOrigin = "https://personal-agent-abcd1234-dxt000-x.vercel.app";
    const rows = [];
    const listeners = new Set();
    const timers = new Map();
    const token = tokenFor(jtis[0]);
    let nextTimer = 0;
    const peer = { postMessage: (data) => {
      if (data.kind === "agent-cross-user-probe") {
        queueMicrotask(() => {
          for (const listener of listeners) listener({ source: peer, origin: bOrigin,
            data: { kind: "agent-cross-user-probe-ack" } });
        });
      }
      if (data.kind === "agent-cross-user-authorization") {
        queueMicrotask(() => {
          for (const callback of timers.values()) callback();
        });
      }
    } };
    const task = runInNewContext(script, {
      atob, Date, Promise, JSON, Uint8Array, URL,
      location: { origin: aOrigin, protocol: "https:", hostname: new URL(aOrigin).hostname, pathname: "/agent" },
      window: { __agentExecutionAcceptanceMode: "security-cross-user", confirm: () => true,
        prompt: () => `${bOrigin}/agent`, open: () => {
          queueMicrotask(() => {
            for (const listener of listeners) listener({ source: peer, origin: bOrigin,
              data: { kind: "agent-cross-user-ready" } });
          });
          return peer;
        },
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener) },
      setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout: (id) => timers.delete(id),
      fetch: async (path) => path === "/api/agent/plan"
        ? { status: 200, json: async () => ({ plan, planAuthorization: "fixture-plan-authorization" }) }
        : { status: 200, json: async () => ({ authorization: token }) },
      console: { table: (value) => rows.push(...value) },
    });
    await Promise.race([task, new Promise((_, reject) => setTimeout(() => reject(new Error("test timeout")), 2000))]);
    expect(rows.findLast((row) => row.scenario === "cross_user_a")).toMatchObject({
      http: "NOT RUN", detail: "B_authorization_ack_missing:message_timeout_after_listener_registered",
    });
    expect(rows.some((row) => row.scenario === "cross_user_a_execute")).toBe(false);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
  it("stops before Plan when the opened B window does not acknowledge the probe", async () => {
    const aOrigin = "https://personal-agent-git-feat-agent-planning-mvp-dxt000-x.vercel.app";
    const bOrigin = "https://personal-agent-abcd1234-dxt000-x.vercel.app";
    const rows = [];
    const listeners = new Set();
    const timers = new Map();
    const sent = [];
    const peer = { postMessage: (data, target) => {
      sent.push({ kind: data.kind, target });
      if (data.kind === "agent-cross-user-probe") queueMicrotask(() => {
        for (const callback of timers.values()) callback();
      });
    } };
    let nextTimer = 0;
    const task = runInNewContext(script, {
      atob, Date, Promise, JSON, Uint8Array, URL,
      location: { origin: aOrigin, protocol: "https:", hostname: new URL(aOrigin).hostname, pathname: "/agent" },
      window: { __agentExecutionAcceptanceMode: "security-cross-user", confirm: () => true,
        prompt: () => `${bOrigin}/agent`, open: () => {
          queueMicrotask(() => {
            for (const listener of listeners) listener({ source: peer, origin: bOrigin,
              data: { kind: "agent-cross-user-ready" } });
          });
          return peer;
        },
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener) },
      setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout: (id) => timers.delete(id),
      fetch: () => { throw new Error("Plan must not run before probe ACK"); },
      console: { table: (value) => rows.push(...value) },
    });
    await Promise.race([task, new Promise((_, reject) => setTimeout(() => reject(new Error("test timeout")), 2000))]);
    expect(sent).toEqual([{ kind: "agent-cross-user-probe", target: bOrigin }]);
    expect(rows.findLast((row) => row.scenario === "cross_user_a")).toMatchObject({
      http: "NOT RUN", detail: "B_probe_ack_missing:message_timeout_after_listener_registered",
    });
  });
  it.each([false, true])("uses two isolated sessions for cross-user handoff (same user=%s)", async (sameUser) => {
    const aOrigin = "https://personal-agent-git-feat-agent-planning-mvp-dxt000-x.vercel.app";
    const bOrigin = "https://personal-agent-abcd1234-dxt000-x.vercel.app";
    const token = tokenFor(jtis[0]);
    const aRows = [];
    const bRows = [];
    const calls = [];
    const transfers = [];
    const aListeners = new Set();
    const bListeners = new Set();
    let toolExecutions = 0;
    let bTask;
    const respond = (status, body) => ({ status, ok: status < 400, json: async () => body });
    const deliver = (listeners, source, origin, data) => {
      for (const listener of listeners) listener({ source, origin, data });
    };
    const aPeer = { postMessage: (data, target) => {
      if (target !== "*" && target !== aOrigin) throw new Error("wrong A target");
      deliver(aListeners, bPeer, bOrigin, data);
    } };
    const bPeer = { postMessage: (data, target) => {
      transfers.push({ kind: data.kind, target });
      if (target !== bOrigin) throw new Error("wrong B target");
      deliver(bListeners, aPeer, aOrigin, data);
    } };
    const aWindow = {
      __agentExecutionAcceptanceMode: "security-cross-user",
      confirm: () => true, prompt: () => `${bOrigin}/agent`,
      addEventListener: (_type, listener) => aListeners.add(listener),
      removeEventListener: (_type, listener) => aListeners.delete(listener),
      open: () => { queueMicrotask(() => { bTask = runInNewContext(script, bContext); }); return bPeer; },
    };
    const bWindow = {
      __agentExecutionAcceptanceMode: "security-cross-user-b", opener: aPeer, confirm: () => true,
      addEventListener: (_type, listener) => bListeners.add(listener),
      removeEventListener: (_type, listener) => bListeners.delete(listener),
    };
    const common = { atob, Date, Promise, JSON, Uint8Array, URL,
      setTimeout: () => 1, clearTimeout: () => undefined };
    const aContext = { ...common, window: aWindow,
      location: { origin: aOrigin, protocol: "https:", hostname: new URL(aOrigin).hostname, pathname: "/agent" },
      fetch: async (path, options) => {
        calls.push(`A:${path}`);
        const body = JSON.parse(options.body);
        if (path === "/api/agent/plan") return respond(200, { plan, planAuthorization: "fixture-plan-authorization" });
        if (path === "/api/agent/confirm") return respond(200, { authorization: token });
        if (path === "/api/agent/execute" && body.authorization === token) {
          toolExecutions += 1;
          return respond(200, { result: { tool: "read_current_time", ok: true,
            data: { iso: "2026-10-19T00:00:00.000Z" } } });
        }
        throw new Error("unexpected A request");
      }, console: { table: (rows) => aRows.push(...rows) },
    };
    const bContext = { ...common, window: bWindow,
      location: { origin: bOrigin, protocol: "https:", hostname: new URL(bOrigin).hostname, pathname: "/agent" },
      fetch: async (path, options) => {
        calls.push(`B:${path}`);
        if (path !== "/api/agent/execute" || JSON.parse(options.body).authorization !== token) {
          throw new Error("unexpected B request");
        }
        if (!sameUser) return respond(400, { error: { code: "INVALID_REQUEST" } });
        toolExecutions += 1;
        return respond(200, { result: { tool: "read_current_time", ok: true,
          data: { iso: "2026-10-19T00:00:00.000Z" } } });
      }, console: { table: (rows) => bRows.push(...rows) },
    };
    const task = runInNewContext(script, aContext);
    await Promise.race([task, new Promise((_, reject) => setTimeout(() => reject(new Error("handoff timeout")), 2000))]);
    await bTask;
    expect(transfers).toContainEqual({ kind: "agent-cross-user-authorization", target: bOrigin });
    expect(transfers).toContainEqual({ kind: "agent-cross-user-probe", target: bOrigin });
    expect(aRows.find((row) => row.detail === "probe_ack_received")).toBeDefined();
    expect(bRows.find((row) => row.detail === "probe_ack_dispatched")).toBeDefined();
    expect(calls).toEqual(sameUser
      ? ["A:/api/agent/plan", "A:/api/agent/confirm", "B:/api/agent/execute"]
      : ["A:/api/agent/plan", "A:/api/agent/confirm", "B:/api/agent/execute", "A:/api/agent/execute"]);
    expect(toolExecutions).toBe(1);
    expect(aRows.find((row) => row.scenario === "cross_user_audit")?.detail)
      .toContain(sameUser ? "verdict=FAIL" : "verdict=HTTP_PASS_AUDIT_REQUIRED");
    expect(bRows.find((row) => row.scenario === "cross_user_b_execute")).toMatchObject(sameUser
      ? { http: 200, detail: "FAIL" }
      : { http: 400, code: "INVALID_REQUEST", detail: "rejected_without_result" });
    expect(JSON.stringify({ aRows, bRows, transfers, calls })).not.toContain(token);
  });
  it.each([
    ["security-tamper", ["/api/agent/plan", "/api/agent/confirm", "/api/agent/confirm"], 0],
    ["security-forgery", ["/api/agent/plan", "/api/agent/confirm", "/api/agent/execute", "/api/agent/execute"], 1],
    ["security-concurrent", ["/api/agent/plan", "/api/agent/confirm", "/api/agent/execute", "/api/agent/execute"], 1],
    ["security-expiry", ["/api/agent/plan", "/api/agent/confirm", "/api/agent/execute"], 0],
  ])("isolates %s with one Auto Plan and explicit confirmations", async (mode, paths, expectedTools) => {
    const result = await runAcceptance(jtis[1], mode);
    expect(result.requestPaths).toEqual(paths);
    expect(result.plans).toBe(1);
    expect(result.confirms).toBe(1);
    expect(result.toolExecutions).toBe(expectedTools);
    expect(result.planBodies[0]).toMatchObject({ provider: "auto", routingPreference: "auto" });
    expect(result.confirmations).toHaveLength(paths.length - (mode === "security-concurrent" ? 1 : 0));
    expect(result.requestPaths).not.toContain("/api/ai/providers");
    const output = JSON.stringify(result.rows);
    for (const token of result.tokens) expect(output).not.toContain(token);
    expect(output).not.toMatch(/fixture-secret|fixture goal|fixture-plan-authorization|private/);
  });

  it.each(["security-cross-user", "security-cross-user-b"])(
    "refuses %s on localhost before opening windows or sending requests", async (mode) => {
      const { rows, requestPaths } = await runAcceptance(jtis[1], mode);
      expect(requestPaths).toEqual([]);
      expect(rows.find((row) => row.scenario === "cross_user")).toMatchObject({
        http: "NOT RUN", detail: "both_sessions_must_use_distinct_preview_origins",
      });
    },
  );

  it("marks concurrent HTTP success as requiring exact-JTI database audit", async () => {
    const { rows, executeBodies, tokens } = await runAcceptance(jtis[1], "security-concurrent");
    expect(executeBodies).toEqual([{ authorization: tokens[0] }, { authorization: tokens[0] }]);
    expect(rows.find((row) => row.scenario === "concurrent_audit")).toMatchObject({
      detail: `jti=${jtis[0]}; http=200,409; code=none,REPLAY_REJECTED; verdict=HTTP_PASS_AUDIT_REQUIRED`,
    });
  });

  it("checks forged rejection before valid execution and expired rejection without a tool result", async () => {
    const forged = await runAcceptance(jtis[1], "security-forgery");
    expect(forged.rows.find((row) => row.scenario === "forged_authorization")).toMatchObject({
      http: 400, code: "INVALID_REQUEST", detail: "rejected_without_result",
    });
    expect(forged.rows.find((row) => row.scenario === "forgery_original_execute")).toMatchObject({
      http: 200, detail: "original_authorization_usable",
    });
    const expired = await runAcceptance(jtis[1], "security-expiry");
    expect(expired.rows.find((row) => row.scenario === "expired_authorization")).toMatchObject({
      http: 400, code: "INVALID_REQUEST", detail: "rejected_without_result",
    });
  });
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
