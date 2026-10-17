// Paste this whole async IIFE into DevTools on the signed-in localhost:3110/agent page.
// Keep the tab open. Only a four-column status table is printed.
(async () => {
  const rows = [];
  const add = (scenario, http, code, detail) => rows.push({ scenario, http, code, detail });
  const request = async (path, body) => {
    const response = await fetch(path, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    return { http: response.status, code: json?.error?.code ?? "", data: json };
  };
  const summary = (scenario, result, detail = "") => add(scenario, result.http, result.code, detail);
  const planBody = {
    provider: "ollama", routingPreference: "privacy",
    messages: [{ role: "user", content: "请制定一个仅读取当前 UTC 时间的简短计划。" }],
  };
  const signatureBytes = (encoded) => Uint8Array.from(
    atob(encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
    (character) => character.charCodeAt(0),
  );
  const forgeSignature = (authorization) => {
    const parts = authorization.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || parts[1].length < 3) return null;
    const middle = Math.floor(parts[1].length / 2);
    const signature = `${parts[1].slice(0, middle)}${parts[1][middle] === "A" ? "B" : "A"}${parts[1].slice(middle + 1)}`;
    const originalBytes = signatureBytes(parts[1]);
    const forgedBytes = signatureBytes(signature);
    if (originalBytes.length !== forgedBytes.length
      || !originalBytes.some((byte, index) => byte !== forgedBytes[index])) return null;
    return `${parts[0]}.${signature}`;
  };
  const createAuthorization = async (label) => {
    const planned = await request("/api/agent/plan", planBody);
    summary(`${label}_plan`, planned, planned.http === 200 ? "received" : "stop");
    if (planned.http !== 200 || !planned.data?.plan || !planned.data?.planAuthorization) return null;
    if (label === "single") {
      const changedGoal = planned.data.plan.goal === "核对当前 UTC 时间" ? "仅读取当前 UTC 时间" : "核对当前 UTC 时间";
      const changedPlan = { ...planned.data.plan, goal: changedGoal };
      const tampered = await request("/api/agent/confirm", {
        plan: changedPlan, planAuthorization: planned.data.planAuthorization,
      });
      summary("tampered_plan", tampered,
        tampered.http === 400 && tampered.code === "INVALID_REQUEST" ? "rejected" : "stop");
      if (tampered.http !== 400 || tampered.code !== "INVALID_REQUEST") return null;
    }
    const confirmed = await request("/api/agent/confirm", {
      plan: planned.data.plan, planAuthorization: planned.data.planAuthorization,
    });
    summary(`${label}_confirm`, confirmed, confirmed.http === 200 ? "received" : "stop");
    if (label === "single") add("plan_binding_pair", "CHECK", "",
      confirmed.http === 200 ? "tampered_rejected_original_accepted" : "NOT VERIFIED");
    return confirmed.http === 200 && confirmed.data?.authorization ? confirmed.data.authorization : null;
  };
  try {
    if (location.origin !== "http://localhost:3110" || location.pathname !== "/agent") {
      add("origin_gate", "NOT RUN", "", "open signed-in http://localhost:3110/agent");
      return;
    }
    const first = await createAuthorization("single");
    if (!first) return;
    const forged = forgeSignature(first);
    if (!forged) {
      add("forged_authorization", "NOT RUN", "", "signature_mutation_not_verified");
      return;
    }
    const forgedResult = await request("/api/agent/execute", { authorization: forged });
    summary("forged_authorization", forgedResult,
      forgedResult.http === 400 && forgedResult.code === "INVALID_REQUEST" ? "rejected_before_valid_execute" : "stop");
    if (forgedResult.http !== 400 || forgedResult.code !== "INVALID_REQUEST") return;
    const executed = await request("/api/agent/execute", { authorization: first });
    const validIso = Number.isFinite(Date.parse(executed.data?.result?.data?.iso));
    summary("execute_first", executed,
      `tool_ok=${executed.data?.result?.tool === "read_current_time" && executed.data?.result?.ok === true}; iso_valid=${validIso}`);
    add("forgery_did_not_consume", "CHECK", "", executed.http === 200 ? "PASS" : "NOT VERIFIED");
    const replay = await request("/api/agent/execute", { authorization: first });
    summary("execute_replay", replay, replay.http === 409 && replay.code === "REPLAY_REJECTED" ? "PASS" : "FAIL");

    const second = await createAuthorization("concurrent");
    if (!second) return;
    const pair = await Promise.all([
      request("/api/agent/execute", { authorization: second }),
      request("/api/agent/execute", { authorization: second }),
    ]);
    for (let i = 0; i < pair.length; i += 1) summary(`concurrent_${i + 1}`, pair[i]);
    add("concurrent_verdict", "CHECK", "",
      pair.filter((item) => item.http === 200).length === 1
      && pair.filter((item) => item.http === 409 && item.code === "REPLAY_REJECTED").length === 1 ? "PASS" : "FAIL");

    const third = await createAuthorization("expiry");
    if (!third) return;
    await new Promise((resolve) => setTimeout(resolve, 32000));
    summary("expired_authorization", await request("/api/agent/execute", { authorization: third }));
  } catch {
    add("script_error", "NOT RUN", "", "network_or_response_error");
  } finally {
    add("cross_user", "NOT RUN", "", "requires separate B session within authorization lifetime");
    console.table(rows);
  }
})();
