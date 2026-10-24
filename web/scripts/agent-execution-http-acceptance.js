// Paste this whole async IIFE into DevTools on the signed-in PersonalAgent Preview /agent page
// (or local http://localhost:3110/agent). Full mode uses the configured OpenRouter model.
// Set window.__agentExecutionAcceptanceMode = "replay-only" for one Auto-routed Plan and a replay check.
// The default full mode asks before making up to three real OpenRouter planning requests.
// Tokens and response bodies are never logged.
(async () => {
  const mode = window.__agentExecutionAcceptanceMode ?? "full";
  const replayOnly = mode === "replay-only";
  const securityModes = ["security-tamper", "security-forgery", "security-concurrent", "security-expiry"];
  const securityMode = securityModes.includes(mode);
  const crossUserA = mode === "security-cross-user";
  const crossUserB = mode === "security-cross-user-b";
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
    provider: replayOnly || securityMode || crossUserA ? "auto" : "openrouter", routingPreference: "auto",
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
  const allowedPeer = (origin) => {
    try {
      const url = new URL(origin);
      return url.protocol === "https:"
        && /^personal-agent-(?:[a-z0-9]{8,12}|git-feat-agent-planning-mvp)-dxt000-x\.vercel\.app$/iu.test(url.hostname)
        && url.origin !== location.origin;
    } catch { return false; }
  };
  const safePeerOrigin = (origin) => allowedPeer(origin) ? new URL(origin).origin : "untrusted_origin";
  const safeMessageKind = (kind) => ["agent-cross-user-ready", "agent-cross-user-probe",
    "agent-cross-user-probe-ack", "agent-cross-user-authorization",
    "agent-cross-user-authorization-ack", "agent-cross-user-go", "agent-cross-user-result"].includes(kind)
    ? kind : "other";
  const waitForPeer = (peer, origin, kind, timeoutMs, stage) => new Promise((resolve) => {
    let rejected = "none";
    let reported = 0;
    const onMessage = (event) => {
      if (reported < 3) {
        add("cross_user_message", "CHECK", "", `stage=${stage}; source=${event.source === peer ? "expected_window" : "unexpected_window"}; `
          + `origin=${safePeerOrigin(event.origin)}; origin_match=${event.origin === origin}; kind=${safeMessageKind(event.data?.kind)}`);
        reported += 1;
      }
      if (event.source !== peer) { rejected = "window_reference_mismatch"; return; }
      if (event.origin !== origin) { rejected = "origin_mismatch"; return; }
      if (event.data?.kind !== kind) { rejected = "message_type_mismatch"; return; }
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve({ data: event.data, reason: "received", source: event.source, origin: event.origin });
    };
    window.addEventListener("message", onMessage);
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ data: null, reason: rejected === "none" ? "message_timeout_after_listener_registered" : rejected });
    }, timeoutMs);
  });
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
  const createAuthorization = async (label, send = request) => {
    const planned = await send("/api/agent/plan", planBody);
    if (!planned) return null;
    summary(`${label}_plan`, planned, planned.http === 200 ? "received" : "stop");
    if (planned.http !== 200 || !planned.data?.plan || !planned.data?.planAuthorization) return null;
    if (label === "single") {
      const changedGoal = planned.data.plan.goal === "核对当前 UTC 时间" ? "仅读取当前 UTC 时间" : "核对当前 UTC 时间";
      const changedPlan = { ...planned.data.plan, goal: changedGoal };
      const tampered = await send("/api/agent/confirm", {
        plan: changedPlan, planAuthorization: planned.data.planAuthorization,
      });
      if (!tampered) return null;
      summary("tampered_plan", tampered,
        tampered.http === 400 && tampered.code === "INVALID_REQUEST" ? "rejected" : "stop");
      if (tampered.http !== 400 || tampered.code !== "INVALID_REQUEST") return null;
    }
    const confirmed = await send("/api/agent/confirm", {
      plan: planned.data.plan, planAuthorization: planned.data.planAuthorization,
    });
    if (!confirmed) return null;
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
    if (mode !== "full" && !replayOnly && !securityMode && !crossUserA && !crossUserB) {
      add("mode_gate", "NOT RUN", "", "unsupported_mode");
      return;
    }
    if ((crossUserA || crossUserB) && allowedLocal) {
      add("cross_user", "NOT RUN", "", "both_sessions_must_use_distinct_preview_origins");
      return;
    }
    if (crossUserB) {
      if (!window.opener || !window.confirm("Confirm this is independently signed-in user B on the SAME Preview deployment, different from user A. Wait for A's short-lived authorization?")) {
        add("cross_user_b", "NOT RUN", "", "independent_B_session_not_confirmed");
        return;
      }
      const received = await new Promise((resolve) => {
        let rejected = "none";
        let reported = 0;
        const onMessage = (event) => {
          const sourceMatches = event.source === window.opener;
          const originAllowed = allowedPeer(event.origin);
          if (reported < 3) {
            add("cross_user_b_message", "CHECK", "", `source=${sourceMatches ? "opener" : "other"}; origin=${safePeerOrigin(event.origin)}; origin_allowed=${originAllowed}; kind=${safeMessageKind(event.data?.kind)}`);
            reported += 1;
          }
          if (!sourceMatches) { rejected = "window_reference_mismatch"; return; }
          if (!originAllowed) { rejected = "origin_mismatch"; return; }
          if (event.data?.kind === "agent-cross-user-probe") {
            window.opener.postMessage({ kind: "agent-cross-user-probe-ack" }, event.origin);
            add("cross_user_b_handoff", "CHECK", "", "probe_ack_dispatched");
            return;
          }
          if (event.data?.kind !== "agent-cross-user-authorization") {
            rejected = "message_type_mismatch"; return;
          }
          if (typeof event.data.authorization !== "string") { rejected = "invalid_authorization_shape"; return; }
          window.removeEventListener("message", onMessage);
          clearTimeout(timer);
          resolve({ authorization: event.data.authorization, origin: event.origin, reason: "received" });
        };
        window.addEventListener("message", onMessage);
        add("cross_user_b_handoff", "CHECK", "", "listener_registered");
        const timer = setTimeout(() => {
          window.removeEventListener("message", onMessage);
          resolve({ authorization: null, reason: rejected === "none"
            ? "message_timeout_after_listener_registered" : rejected });
        }, 120000);
        window.opener.postMessage({ kind: "agent-cross-user-ready" }, "*");
        add("cross_user_b_handoff", "CHECK", "", "ready_dispatched");
      });
      if (!received.authorization) {
        add("cross_user_b", "NOT RUN", "", `authorization_not_received:${received.reason}`); return;
      }
      const jti = authorizationJti(received.authorization);
      if (!jti) { add("cross_user_b", "NOT RUN", "", "invalid_authorization_jti"); return; }
      add("cross_user_b_handoff", "CHECK", "", "authorization_received");
      window.opener.postMessage({ kind: "agent-cross-user-authorization-ack", jti }, received.origin);
      const go = await waitForPeer(window.opener, received.origin, "agent-cross-user-go", 10000, "B_go");
      if (!go.data || go.data.jti !== jti) {
        add("cross_user_b", "NOT RUN", "", `execution_go_missing:${go.reason}`); return;
      }
      if (!window.confirm("Send one Execute request as user B? The signed authorization must be rejected without a tool result.")) {
        add("cross_user_b", "NOT RUN", "", "request_not_confirmed");
        return;
      }
      const rejected = await request("/api/agent/execute", { authorization: received.authorization });
      const valid = rejected.http === 400 && rejected.code === "INVALID_REQUEST"
        && !Object.hasOwn(rejected.data ?? {}, "result");
      summary("cross_user_b_execute", rejected, valid ? "rejected_without_result" : "FAIL");
      window.opener.postMessage({ kind: "agent-cross-user-result", jti, http: rejected.http,
        code: safeErrorCode(rejected.code), hasResult: Object.hasOwn(rejected.data ?? {}, "result") }, received.origin);
      add("cross_user_b", "CHECK", "", `jti=${jti}; verdict=${valid ? "HTTP_REJECTED_A_CHECK_REQUIRED" : "FAIL"}`);
      return;
    }
    if (crossUserA) {
      const typed = window.prompt("Enter user B's /agent URL on the SAME Preview deployment, using a different origin and independent login. No token is placed in the URL.");
      let peerUrl;
      try { peerUrl = new URL(typed); } catch { peerUrl = null; }
      if (!peerUrl || !allowedPeer(peerUrl.origin) || peerUrl.pathname !== "/agent"
        || peerUrl.search || peerUrl.hash) {
        add("cross_user_a", "NOT RUN", "", "invalid_B_preview_url");
        return;
      }
      if (!window.confirm("Confirm user A and user B are different signed-in accounts on the SAME deployment; authorize one Auto Plan, one Confirm, B Execute, then A Execute?")) {
        add("cross_user_a", "NOT RUN", "", "operator_declined");
        return;
      }
      const peer = window.open(peerUrl.href, "_blank");
      if (!peer) { add("cross_user_a", "NOT RUN", "", "B_window_unavailable"); return; }
      add("cross_user_a", "CHECK", "", "run security-cross-user-b in the opened B tab");
      const ready = await waitForPeer(peer, peerUrl.origin, "agent-cross-user-ready", 120000, "A_ready");
      if (!ready.data) { add("cross_user_a", "NOT RUN", "", `B_ready_missing:${ready.reason}`); return; }
      add("cross_user_a_handoff", "CHECK", "", "B_ready_received");
      if (peer.closed || ready.source !== peer || ready.origin !== peerUrl.origin) {
        add("cross_user_a", "NOT RUN", "", "B_window_reference_or_origin_changed"); return;
      }
      const probePending = waitForPeer(peer, peerUrl.origin, "agent-cross-user-probe-ack", 5000, "A_probe_ack");
      peer.postMessage({ kind: "agent-cross-user-probe" }, peerUrl.origin);
      add("cross_user_a_handoff", "CHECK", "", `probe_dispatched; target=ready_window; origin=${safePeerOrigin(peerUrl.origin)}; kind=agent-cross-user-probe`);
      const probe = await probePending;
      if (!probe.data) { add("cross_user_a", "NOT RUN", "", `B_probe_ack_missing:${probe.reason}`); return; }
      add("cross_user_a_handoff", "CHECK", "", "probe_ack_received");
      const send = async (path, body) => {
        if (!window.confirm(`Send ${path === "/api/agent/plan" ? "one Auto Plan" : "one Confirm"} as user A?`)) return null;
        return request(path, body);
      };
      const authorization = await createAuthorization("cross_user_a", send);
      if (!authorization) return;
      const jti = authorizationJti(authorization);
      if (!jti) { add("cross_user_a", "NOT RUN", "", "signed_authorization_jti_unavailable"); return; }
      if (!window.confirm("Transfer the short-lived authorization only to the verified B window, then automatically Execute once as A after B responds?")) {
        add("cross_user_a", "NOT RUN", "", "handoff_declined");
        return;
      }
      if (peer.closed || ready.source !== peer) {
        add("cross_user_a", "NOT RUN", "", "B_window_reference_changed_before_authorization"); return;
      }
      const ackPending = waitForPeer(peer, peerUrl.origin, "agent-cross-user-authorization-ack", 5000, "A_authorization_ack");
      peer.postMessage({ kind: "agent-cross-user-authorization", authorization }, peerUrl.origin);
      add("cross_user_a_handoff", "CHECK", "", `authorization_dispatched_to_verified_origin; target=ready_window; origin=${safePeerOrigin(peerUrl.origin)}; kind=agent-cross-user-authorization`);
      const ack = await ackPending;
      if (!ack.data || ack.data.jti !== jti) {
        add("cross_user_a", "NOT RUN", "", `B_authorization_ack_missing:${ack.reason}`); return;
      }
      add("cross_user_a_handoff", "CHECK", "", "authorization_acknowledged");
      const bResultPending = waitForPeer(peer, peerUrl.origin, "agent-cross-user-result", 15000, "A_B_result");
      peer.postMessage({ kind: "agent-cross-user-go", jti }, peerUrl.origin);
      const bResultReceived = await bResultPending;
      const bResult = bResultReceived.data;
      if (!bResult || bResult.jti !== jti) {
        add("cross_user_a", "NOT RUN", "", `B_result_missing_or_mismatched:${bResultReceived.reason}`); return;
      }
      const bRejected = bResult.http === 400 && bResult.code === "INVALID_REQUEST" && bResult.hasResult === false;
      add("cross_user_b_execute", bResult.http, safeErrorCode(bResult.code), bRejected ? "rejected_without_result" : "FAIL");
      if (!bRejected) { add("cross_user_audit", "CHECK", "", `jti=${jti}; verdict=FAIL`); return; }
      const aResult = await request("/api/agent/execute", { authorization });
      const aSucceeded = aResult.http === 200 && aResult.data?.result?.tool === "read_current_time"
        && aResult.data?.result?.ok === true && Number.isFinite(Date.parse(aResult.data?.result?.data?.iso));
      summary("cross_user_a_execute", aResult, aSucceeded ? "original_authorization_usable" : "FAIL");
      add("cross_user_audit", "CHECK", "", `jti=${jti}; http=${bResult.http},${aResult.http}; `
        + `code=${safeErrorCode(bResult.code) || "none"},${safeErrorCode(aResult.code) || "none"}; `
        + `verdict=${aSucceeded ? "HTTP_PASS_AUDIT_REQUIRED" : "FAIL"}`);
      return;
    }

    if (securityMode) {
      const send = async (path, body) => {
        const action = path === "/api/agent/plan" ? "one Auto-routed Plan (may consume model quota)"
          : path === "/api/agent/confirm" ? "one Confirm (writes a test authorization)"
            : "one Execute (may run read_current_time)";
        if (!window.confirm(`Send ${action} to this signed-in test environment?`)) {
          add("operator_confirmation", "SKIPPED", "", "cancelled_before_request");
          return null;
        }
        return request(path, body);
      };
      const label = mode === "security-tamper" ? "single" : mode;
      const authorization = await createAuthorization(label, send);
      if (!authorization) return;
      if (mode === "security-tamper") {
        add("tamper_verdict", "CHECK", "", "tampered_confirm_rejected_original_confirm_accepted; no_execute_request");
        return;
      }
      if (mode === "security-forgery") {
        const forged = forgeSignature(authorization);
        if (!forged) { add("forged_authorization", "NOT RUN", "", "signature_mutation_not_verified"); return; }
        const rejected = await send("/api/agent/execute", { authorization: forged });
        if (!rejected) return;
        summary("forged_authorization", rejected,
          rejected.http === 400 && rejected.code === "INVALID_REQUEST" && !Object.hasOwn(rejected.data ?? {}, "result")
            ? "rejected_without_result" : "FAIL");
        if (rejected.http !== 400 || rejected.code !== "INVALID_REQUEST" || Object.hasOwn(rejected.data ?? {}, "result")) return;
        const valid = await send("/api/agent/execute", { authorization });
        if (!valid) return;
        const ok = valid.http === 200 && valid.data?.result?.tool === "read_current_time"
          && valid.data?.result?.ok === true && Number.isFinite(Date.parse(valid.data?.result?.data?.iso));
        summary("forgery_original_execute", valid, ok ? "original_authorization_usable" : "FAIL");
        return;
      }
      if (mode === "security-expiry") {
        await new Promise((resolve) => setTimeout(resolve, 32000));
        const expired = await send("/api/agent/execute", { authorization });
        if (!expired) return;
        summary("expired_authorization", expired,
          expired.http === 400 && expired.code === "INVALID_REQUEST" && !Object.hasOwn(expired.data ?? {}, "result")
            ? "rejected_without_result" : "FAIL");
        return;
      }
      const jti = authorizationJti(authorization);
      if (!jti) { add("concurrent_audit", "NOT RUN", "", "signed_authorization_jti_unavailable"); return; }
      if (!window.confirm("Send two concurrent Execute requests with the same authorization?")) {
        add("operator_confirmation", "SKIPPED", "", "cancelled_before_request");
        return;
      }
      const pair = await Promise.all([
        request("/api/agent/execute", { authorization }), request("/api/agent/execute", { authorization }),
      ]);
      for (let i = 0; i < pair.length; i += 1) summary(`concurrent_${i + 1}`, pair[i]);
      const winner = pair.filter((item) => item.http === 200 && item.data?.result?.tool === "read_current_time"
        && item.data?.result?.ok === true && Number.isFinite(Date.parse(item.data?.result?.data?.iso)));
      const loser = pair.filter((item) => item.http === 409 && item.code === "REPLAY_REJECTED"
        && !Object.hasOwn(item.data ?? {}, "result"));
      const verdict = winner.length === 1 && loser.length === 1 ? "HTTP_PASS_AUDIT_REQUIRED" : "FAIL";
      add("concurrent_audit", "CHECK", "", `jti=${jti}; http=${pair[0].http},${pair[1].http}; `
        + `code=${safeConcurrentCode(pair[0]) || "none"},${safeConcurrentCode(pair[1]) || "none"}; verdict=${verdict}`);
      return;
    }

    if (replayOnly) {
      const proceed = window.confirm("Replay-only acceptance will make one Auto-routed planning request, "
        + "one confirmation and two Execute requests using the same authorization. "
        + "Auto may choose a cloud provider and consume quota. Continue?");
      if (!proceed) {
        add("operator_confirmation", "SKIPPED", "", "cancelled_before_model_requests");
        return;
      }
      const authorization = await createAuthorization("replay");
      if (!authorization) return;
      const jti = authorizationJti(authorization);
      if (!jti) {
        add("replay_audit", "NOT RUN", "", "signed_authorization_jti_unavailable");
        return;
      }
      const first = await request("/api/agent/execute", { authorization });
      const firstValid = first.http === 200 && first.data?.result?.tool === "read_current_time"
        && first.data?.result?.ok === true && Number.isFinite(Date.parse(first.data?.result?.data?.iso));
      summary("replay_execute_first", first, firstValid ? "tool_ok=true; iso_valid=true" : "FAIL");
      if (!firstValid) return;
      const second = await request("/api/agent/execute", { authorization });
      const replayRejected = second.http === 409 && second.code === "REPLAY_REJECTED"
        && !Object.hasOwn(second.data ?? {}, "result");
      summary("replay_execute_second", second, replayRejected ? "rejected_without_result" : "FAIL");
      add("replay_audit", "CHECK", "", `jti=${jti}; http=${first.http},${second.http}; `
        + `code=none,${safeConcurrentCode(second) || "none"}; verdict=${replayRejected ? "PASS" : "FAIL"}`);
      return;
    }

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
    if (mode === "full") add("cross_user", "NOT RUN", "", "requires separate B session within authorization lifetime");
    console.table(rows);
  }
})();
