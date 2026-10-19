// Paste this whole async IIFE into DevTools on the signed-in PersonalAgent Preview /agent page
// (or local http://localhost:3110/agent). It uses the configured OpenRouter model.
// It asks before making up to three real planning requests. Tokens and response bodies are never logged.
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
  const safeErrorCode = (code) => ["AUTH_REQUIRED", "INVALID_REQUEST", "REPLAY_REJECTED",
    "RATE_LIMITED", "TIMEOUT", "PROVIDER_ERROR", "EXECUTION_UNAVAILABLE", "QUOTA_UNAVAILABLE"].includes(code)
    ? code : code ? "OTHER" : "";
  const summary = (scenario, result, detail = "") => add(scenario, result.http, safeErrorCode(result.code), detail);
  const planBody = {
    provider: "openrouter", routingPreference: "auto",
    messages: [{ role: "user", content: "请制定一个仅读取当前 UTC 时间的简短计划。" }],
  };
  const signatureBytes = (encoded) => Uint8Array.from(
    atob(encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
    (character) => character.charCodeAt(0),
  );
  // Correlation only: the server still verifies the signature and database state.
  const authorizationJti = (authorization) => {
    try {
      const parts = authorization.split(".");
      if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/u.test(parts[0])) return null;
      const payload = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")
        .padEnd(Math.ceil(parts[0].length / 4) * 4, "=")));
      return typeof payload?.jti === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(payload.jti)
        ? payload.jti : null;
    } catch { return null; }
  };
  const safeConcurrentCode = (result) => result.http === 200 ? ""
    : result.http === 409 && result.code === "REPLAY_REJECTED" ? "REPLAY_REJECTED" : "OTHER";
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
    const allowedLocal = location.origin === "http://localhost:3110";
    const allowedPreviewHost = /^personal-agent-(?:[a-z0-9]{8,12}|git-feat-agent-planning-mvp)-dxt000-x\.vercel\.app$/iu.test(location.hostname);
    if ((!allowedLocal && !(location.protocol === "https:" && allowedPreviewHost)) || location.pathname !== "/agent") {
      add("origin_gate", "NOT RUN", "", "open the signed-in feat/agent-planning-mvp Preview /agent page");
      return;
    }
    add("origin_gate", "CHECK", "", allowedLocal ? "localhost" : "branch Preview host accepted");

    // This authenticated GET only reports provider configuration; it does not generate model output.
    const providerResponse = await fetch("/api/ai/providers", {
      method: "GET", credentials: "same-origin", cache: "no-store",
    });
    const providerData = await providerResponse.json().catch(() => null);
    const openrouter = Array.isArray(providerData)
      ? providerData.find((entry) => entry?.id === "openrouter")
      : null;
    if (!providerResponse.ok || !openrouter
      || typeof openrouter.configured !== "boolean" || typeof openrouter.model !== "string") {
      add("openrouter_preflight", providerResponse.status, "", "could_not_verify_model_configuration");
      return;
    }
    add("openrouter_preflight", providerResponse.status, "",
      "configured=" + openrouter.configured + "; model=" + openrouter.model);
    if (!openrouter.configured) return;

    const modelLooksFree = openrouter.model === "openrouter/free" || /:free$/iu.test(openrouter.model);
    const costNote = modelLooksFree
      ? "The model name looks like a free route, but availability and rate limits still apply."
      : "This model is not clearly a free route and may incur OpenRouter charges.";
    const proceed = window.confirm([
      "Preview Agent HTTP acceptance will make up to 3 real OpenRouter planning requests.",
      "Configured model: " + openrouter.model,
      "Each attempt may consume one of the app's 30 daily cloud-model quota units, even if the provider call fails.",
      costNote,
      "Check the OpenRouter account's model pricing and usage first. Continue?",
    ].join("\n"));
    if (!proceed) {
      add("operator_confirmation", "SKIPPED", "", "cancelled_before_model_requests");
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
    add("forgery_did_not_consume", "CHECK", "",
      executed.http === 200 && executed.data?.result?.ok === true && validIso ? "PASS" : "FAIL");
    const replay = await request("/api/agent/execute", { authorization: first });
    summary("execute_replay", replay, replay.http === 409 && replay.code === "REPLAY_REJECTED" ? "PASS" : "FAIL");

    const second = await createAuthorization("concurrent");
    if (!second) return;
    const concurrentJti = authorizationJti(second);
    if (!concurrentJti) {
      add("concurrent_audit", "NOT RUN", "", "signed_authorization_jti_unavailable");
      return;
    }
    const pair = await Promise.all([
      request("/api/agent/execute", { authorization: second }),
      request("/api/agent/execute", { authorization: second }),
    ]);
    for (let i = 0; i < pair.length; i += 1) summary(`concurrent_${i + 1}`, pair[i]);
    const concurrentVerdict = pair.filter((item) => item.http === 200).length === 1
      && pair.filter((item) => item.http === 409 && item.code === "REPLAY_REJECTED").length === 1 ? "PASS" : "FAIL";
    add("concurrent_verdict", "CHECK", "", concurrentVerdict);
    add("concurrent_audit", "CHECK", "", `jti=${concurrentJti}; http=${pair[0].http},${pair[1].http}; `
      + `code=${safeConcurrentCode(pair[0]) || "none"},${safeConcurrentCode(pair[1]) || "none"}; verdict=${concurrentVerdict}`);

    const third = await createAuthorization("expiry");
    if (!third) return;
    await new Promise((resolve) => setTimeout(resolve, 32000));
    const expired = await request("/api/agent/execute", { authorization: third });
    summary("expired_authorization", expired,
      expired.http === 400 && expired.code === "INVALID_REQUEST" ? "PASS" : "FAIL");
  } catch {
    add("script_error", "NOT RUN", "", "network_or_response_error");
  } finally {
    add("cross_user", "NOT RUN", "", "requires separate B session within authorization lifetime");
    console.table(rows);
  }
})();
