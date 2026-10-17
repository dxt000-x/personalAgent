"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { PageHeader } from "./page-header";
import { AgentTimeline } from "./agent-timeline";
import { AgentMessage, type AgentChatMessage } from "./agent-message";
import { AgentProviderSelector } from "./agent-provider-selector";
import { MAX_PLAN_TASK_CHARS, parseAgentPlanText, type AgentPlan } from "@/lib/agent/planning";
import type { ChatMessage, MemoryUsage, ProviderId, ProviderSelection, ProviderStatus, RoutingPreference, RoutingReason } from "@/lib/ai/types";
import {
  MAX_INPUT_CHARACTERS,
  MAX_MESSAGE_CHARACTERS,
  MAX_MESSAGES,
} from "@/lib/ai/limits";
import type { MemoryCandidate } from "@/lib/ai/memory-candidates";
import { isPossibleMemoryDuplicate, normalizeMemoryContent } from "@/lib/memories/normalize";
import { MAX_SEARCH_QUERY_CHARS, MAX_SEARCH_RESULTS, MAX_SEARCH_SNIPPET_CHARS, MAX_SEARCH_TOTAL_CHARS,
  type KnowledgeSearchResult } from "@/lib/knowledge/search-types";

type CandidateEntry = MemoryCandidate & { id: string; status: "pending" | "saving" | "saved" | "duplicate" | "error" };

type GatewayErrorCode =
  | "AUTH_REQUIRED"
  | "PROVIDER_NOT_CONFIGURED"
  | "PRIVACY_PROVIDER_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_REQUEST_REJECTED"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "CLOUD_QUOTA_EXCEEDED"
  | "QUOTA_UNAVAILABLE"
  | "TIMEOUT"
  | "KNOWLEDGE_UNAVAILABLE"
  | "KNOWLEDGE_CONTEXT_LIMIT";

type RetryRequest = { provider: ProviderSelection; routingPreference: RoutingPreference; messages: ChatMessage[];
  knowledge?: { enabled: true; query: string } };
type TimelineState =
  | { state: "idle" | "running" | "success"; resolvedProvider?: ProviderId; model?: string; reason?: RoutingReason; memory?: MemoryUsage }
  | { state: "error"; code: GatewayErrorCode };
type PlanningState =
  | { status: "idle" | "generating" | "cancelled" }
  | { status: "pending"; plan: AgentPlan; planAuthorization: string | null }
  | { status: "executing"; plan: AgentPlan }
  | { status: "completed"; plan: AgentPlan; iso: string }
  | { status: "error"; code: GatewayErrorCode; phase?: "execution" };

const providerLabels: Record<ProviderId, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

const errorMessages: Record<GatewayErrorCode, string> = {
  AUTH_REQUIRED: "登录状态已失效，请重新登录后再试。",
  PROVIDER_NOT_CONFIGURED: "所选 Provider 尚未配置，请选择已配置的 Provider。",
  PRIVACY_PROVIDER_UNAVAILABLE: "没有可用的本地模型。Privacy 模式不会将消息发送到云端。",
  INVALID_REQUEST: "消息超出当前对话限制，请缩短内容或清空会话后重试。",
  PROVIDER_AUTH_FAILED: "模型服务认证或权限校验失败，请检查服务配置。",
  PROVIDER_REQUEST_REJECTED: "模型服务拒绝了本次请求，请检查模型配置后重试。",
  PROVIDER_ERROR: "模型服务暂时不可用。请检查 Provider 服务状态后重试。",
  RATE_LIMITED: "请求过于频繁，请稍后重试。",
  CLOUD_QUOTA_EXCEEDED: "今日云端 AI 使用次数已达到上限，请于下一个 UTC 日期重置后再试。",
  QUOTA_UNAVAILABLE: "云端 AI 使用额度暂时无法核验，请稍后重试。",
  TIMEOUT: "模型响应超时，请稍后重试。",
  KNOWLEDGE_UNAVAILABLE: "知识库检索暂时不可用，本次未生成知识库回答。请稍后重试。",
  KNOWLEDGE_CONTEXT_LIMIT: "本次对话已没有足够空间加入知识库资料，请清空会话或缩短消息。",
};

const gatewayErrorCodes = new Set<GatewayErrorCode>([
  "AUTH_REQUIRED",
  "PROVIDER_NOT_CONFIGURED",
  "PRIVACY_PROVIDER_UNAVAILABLE",
  "INVALID_REQUEST",
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_REQUEST_REJECTED",
  "PROVIDER_ERROR",
  "RATE_LIMITED",
  "CLOUD_QUOTA_EXCEEDED",
  "QUOTA_UNAVAILABLE",
  "TIMEOUT",
  "KNOWLEDGE_UNAVAILABLE",
  "KNOWLEDGE_CONTEXT_LIMIT",
]);

function asGatewayErrorCode(value: unknown): GatewayErrorCode {
  return typeof value === "string" && gatewayErrorCodes.has(value as GatewayErrorCode)
    ? value as GatewayErrorCode
    : "PROVIDER_ERROR";
}

function boundedConversation(messages: ChatMessage[]): ChatMessage[] {
  const normalized = messages.map((message) => {
    if (message.content.length <= MAX_MESSAGE_CHARACTERS) return message;
    const suffix = "…[历史回复已截断]";
    return {
      ...message,
      content: `${message.content.slice(0, MAX_MESSAGE_CHARACTERS - suffix.length)}${suffix}`,
    };
  });

  const selected: ChatMessage[] = [];
  let totalCharacters = 0;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index];
    if (selected.length >= MAX_MESSAGES) break;
    if (totalCharacters + message.content.length > MAX_INPUT_CHARACTERS) break;
    selected.unshift(message);
    totalCharacters += message.content.length;
  }
  return selected;
}

function readProviderStatuses(value: unknown): ProviderStatus[] {
  if (!Array.isArray(value)) throw new Error("invalid provider status");
  const allowedIds = new Set<ProviderId>(["ollama", "openrouter", "openai", "deepseek", "gemini"]);
  return value.filter((item): item is ProviderStatus => {
    if (typeof item !== "object" || item === null) return false;
    const status = item as Partial<ProviderStatus>;
    return typeof status.id === "string"
      && allowedIds.has(status.id as ProviderId)
      && typeof status.configured === "boolean"
      && (status.type === "local" || status.type === "cloud")
      && ["unknown", "available", "unavailable"].includes(String(status.availability))
      && typeof status.model === "string";
  });
}

function providerRequestMessages(entries: AgentChatMessage[]): ChatMessage[] {
  return boundedConversation(entries.map(({ role, content }) => ({ role, content })));
}

function readMemoryUsage(value: unknown): MemoryUsage {
  if (typeof value !== "object" || value === null) {
    return { status: "unavailable", used: false, count: 0 };
  }
  const memory = value as Partial<MemoryUsage>;
  if (["used", "none", "unavailable", "omitted"].includes(String(memory.status))
    && typeof memory.used === "boolean"
    && typeof memory.count === "number"
    && Number.isInteger(memory.count)
    && memory.count >= 0 && memory.count <= 8) {
    return memory as MemoryUsage;
  }
  return { status: "unavailable", used: false, count: 0 };
}

function readKnowledgeUsage(value: unknown): { status: "used" | "no_match"; sources: KnowledgeSearchResult[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = value as { status?: unknown; sources?: unknown };
  if ((usage.status !== "used" && usage.status !== "no_match") || !Array.isArray(usage.sources)
    || usage.sources.length > MAX_SEARCH_RESULTS || (usage.status === "used" && usage.sources.length === 0)
    || (usage.status === "no_match" && usage.sources.length !== 0)) return null;
  let total = 0;
  const sources: KnowledgeSearchResult[] = [];
  for (const row of usage.sources) {
    if (!row || typeof row !== "object") return null;
    const source = row as Partial<KnowledgeSearchResult>;
    if (typeof source.documentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(source.documentId)
      || typeof source.fileName !== "string" || source.fileName.length > 180
      || typeof source.chunkIndex !== "number" || !Number.isInteger(source.chunkIndex) || source.chunkIndex < 0
      || typeof source.snippet !== "string" || source.snippet.length > MAX_SEARCH_SNIPPET_CHARS) return null;
    total += source.snippet.length;
    if (total > MAX_SEARCH_TOTAL_CHARS) return null;
    sources.push(source as KnowledgeSearchResult);
  }
  return { status: usage.status, sources };
}

export function AgentWorkspace({ sessionKey = "default" }: { sessionKey?: string }) {
  return <AgentWorkspaceSession key={sessionKey} sessionKey={sessionKey} />;
}

function AgentWorkspaceSession({ sessionKey }: { sessionKey: string }) {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderSelection>("auto");
  const [routingPreference, setRoutingPreference] = useState<RoutingPreference>("auto");
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorCode, setErrorCode] = useState<GatewayErrorCode | null>(null);
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(false);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeNoMatch, setKnowledgeNoMatch] = useState(false);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [timeline, setTimeline] = useState<TimelineState>({ state: "idle" });
  const [planning, setPlanning] = useState<PlanningState>({ status: "idle" });
  const planningGeneration = useRef(0);
  const planningController = useRef<AbortController | null>(null);
  const planningActive = useRef(false);
  const executingRef = useRef(false);
  const sendingRef = useRef(false);
  const [memorySuggestionsEnabled, setMemorySuggestionsEnabled] = useState(false);
  const suggestionsEnabledRef = useRef(false);
  const [candidates, setCandidates] = useState<CandidateEntry[]>([]);
  const [extractingCandidates, setExtractingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState(false);
  const candidateGeneration = useRef(0);
  const candidateController = useRef<AbortController | null>(null);
  const accountGeneration = useRef(0);
  const candidateSaving = useRef(new Set<string>());
  const chatGeneration = useRef(0);
  const chatController = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const selectedStatus = useMemo(
    () => selectedProvider === "auto" ? undefined : providers.find(({ id }) => id === selectedProvider),
    [providers, selectedProvider],
  );

  useEffect(() => {
    let active = true;
    async function loadProviders() {
      setProvidersLoading(true);
      setProvidersError(false);
      try {
        const response = await fetch("/api/ai/providers", { cache: "no-store" });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error("provider status unavailable");
        const result = readProviderStatuses(body);
        if (!active) return;
        setProviders(result);
        setSelectedProvider("auto");
      } catch {
        if (active) setProvidersError(true);
      } finally {
        if (active) setProvidersLoading(false);
      }
    }
    void loadProviders();
    return () => { active = false; };
  }, [sessionKey]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      chatGeneration.current += 1;
      chatController.current?.abort();
      chatController.current = null;
      planningGeneration.current += 1;
      planningController.current?.abort();
      planningController.current = null;
      planningActive.current = false;
      executingRef.current = false;
      candidateGeneration.current += 1;
      candidateController.current?.abort();
      candidateController.current = null;
      accountGeneration.current += 1;
    };
  }, []);

  async function requestCandidates(request: RetryRequest, expectedChatGeneration: number) {
    if (!mounted.current || expectedChatGeneration !== chatGeneration.current) return;
    const message = request.messages.at(-1);
    if (!message || message.role !== "user") return;
    const generation = ++candidateGeneration.current;
    candidateController.current?.abort();
    const controller = new AbortController();
    candidateController.current = controller;
    setCandidates([]);
    setCandidateError(false);
    setExtractingCandidates(true);
    try {
      const response = await fetch("/api/ai/memory-candidates", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: request.provider,
          ...(request.provider === "auto" ? { routingPreference: request.routingPreference } : {}),
          message: message.content,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok || typeof body !== "object" || body === null || !Array.isArray((body as { candidates?: unknown }).candidates)) {
        throw new Error("candidate extraction failed");
      }
      if (!mounted.current || controller.signal.aborted || generation !== candidateGeneration.current) return;
      const rows = (body as { candidates: unknown[] }).candidates;
      const valid = rows.slice(0, 3).filter((row): row is MemoryCandidate => {
        if (typeof row !== "object" || row === null) return false;
        const candidate = row as Partial<MemoryCandidate>;
        return typeof candidate.content === "string" && !!candidate.content.trim() && candidate.content.length <= 500
          && typeof candidate.reason === "string" && typeof candidate.category === "string"
          && ["preference", "profile", "goal", "work", "study", "habit", "other"].includes(candidate.category)
          && Number.isInteger(candidate.importance) && Number(candidate.importance) >= 1 && Number(candidate.importance) <= 5;
      });
      setCandidates(valid.map((candidate) => ({ ...candidate, id: crypto.randomUUID(), status: "pending" })));
    } catch {
      if (mounted.current && !controller.signal.aborted && generation === candidateGeneration.current) setCandidateError(true);
    } finally {
      if (candidateController.current === controller) candidateController.current = null;
      if (mounted.current && generation === candidateGeneration.current) setExtractingCandidates(false);
    }
  }

  async function saveCandidate(candidate: CandidateEntry) {
    if (candidate.status === "saved" || candidate.status === "duplicate" || candidateSaving.current.has(candidate.id)) return;
    candidateSaving.current.add(candidate.id);
    // A new conversation invalidates suggestions, but must not cancel a save the user confirmed.
    // Only leaving this account/session prevents a not-yet-started Memory POST.
    const generation = accountGeneration.current;
    setCandidates((current) => current.map((entry) => entry.id === candidate.id ? { ...entry, status: "saving" } : entry));
    try {
      // Recheck the current user's Memory immediately before saving to avoid common repeats.
      const existingResponse = await fetch("/api/memories", { cache: "no-store" });
      if (!existingResponse.ok) throw new Error("memory lookup failed");
      const existingBody: unknown = await existingResponse.json();
      const existing = typeof existingBody === "object" && existingBody !== null
        ? (existingBody as { memories?: unknown }).memories : undefined;
      if (!Array.isArray(existing)) throw new Error("memory lookup failed");
      const contents = existing.flatMap((row) => typeof row === "object" && row !== null
        && typeof (row as { content?: unknown }).content === "string" ? [(row as { content: string }).content] : []);
      const duplicate = contents.some((content) => normalizeMemoryContent(content) === normalizeMemoryContent(candidate.content));
      if (generation !== accountGeneration.current) return;
      if (duplicate) {
        setCandidates((current) => current.map((entry) => entry.id === candidate.id ? { ...entry, status: "duplicate" } : entry));
        return;
      }
      if (contents.some((content) => isPossibleMemoryDuplicate(content, candidate.content))
        && !window.confirm("可能已有相近记忆，仍要保存这条候选吗？")) {
        setCandidates((current) => current.map((entry) => entry.id === candidate.id ? { ...entry, status: "pending" } : entry));
        return;
      }
      if (generation !== accountGeneration.current) return;
      const response = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: candidate.content, category: candidate.category, importance: candidate.importance }),
      });
      if (response.status === 409) {
        const body: unknown = await response.json();
        if (typeof body === "object" && body !== null && "error" in body
          && typeof body.error === "object" && body.error !== null && "code" in body.error
          && body.error.code === "MEMORY_DUPLICATE") {
          if (generation === accountGeneration.current) setCandidates((current) => current.map((entry) => entry.id === candidate.id ? { ...entry, status: "duplicate" } : entry));
          return;
        }
      }
      if (!response.ok) throw new Error("memory save failed");
      if (generation !== accountGeneration.current) return;
      setCandidates((current) => current.map((entry) => entry.id === candidate.id ? { ...entry, status: "saved" } : entry));
    } catch {
      if (generation === accountGeneration.current) {
        setCandidates((current) => current.map((entry) => entry.id === candidate.id ? { ...entry, status: "error" } : entry));
      }
    } finally {
      candidateSaving.current.delete(candidate.id);
    }
  }

  function resetCandidates() {
    candidateGeneration.current += 1;
    candidateController.current?.abort();
    candidateController.current = null;
    setCandidates([]);
    setExtractingCandidates(false);
    setCandidateError(false);
  }

  async function sendRequest(request: RetryRequest) {
    if (sendingRef.current || !mounted.current) return;
    sendingRef.current = true;
    const generation = ++chatGeneration.current;
    const controller = new AbortController();
    chatController.current = controller;
    const stillCurrent = () => mounted.current && generation === chatGeneration.current && !controller.signal.aborted;
    setIsSending(true);
    setErrorCode(null);
    setKnowledgeNoMatch(false);
    setTimeline({ state: "running" });
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          provider: request.provider,
          ...(request.provider === "auto" ? { routingPreference: request.routingPreference } : {}),
          messages: request.messages,
          ...(request.knowledge ? { knowledge: request.knowledge } : {}),
        }),
      });
      if (!stillCurrent()) return;
      const body: unknown = await response.json();
      if (!stillCurrent()) return;
      if (!response.ok) {
        const error = typeof body === "object" && body !== null
          ? (body as { error?: { code?: unknown } }).error
          : undefined;
        throw new Error(asGatewayErrorCode(error?.code));
      }

      const knowledgeUsage = request.knowledge && typeof body === "object" && body !== null
        ? readKnowledgeUsage((body as { knowledge?: unknown }).knowledge) : null;
      if (request.knowledge && !knowledgeUsage) throw new Error("PROVIDER_ERROR");
      if (knowledgeUsage?.status === "no_match") {
        setKnowledgeNoMatch(true);
        setRetryRequest(null);
        setTimeline({ state: "idle" });
        return;
      }

      const result = body as {
        text?: unknown;
        provider?: unknown;
        model?: unknown;
        memory?: unknown;
        routing?: { mode?: unknown; reason?: unknown };
      };
      if (typeof result.text !== "string" || !result.text.trim()
        || typeof result.provider !== "string"
        || !["openai", "deepseek", "gemini", "ollama", "openrouter"].includes(result.provider)
        || (request.provider !== "auto" && result.provider !== request.provider)
        || typeof result.model !== "string") {
        throw new Error("PROVIDER_ERROR");
      }
      const actualProvider = result.provider as ProviderId;
      const memoryUsage = readMemoryUsage(result.memory);
      const assistantMessage: AgentChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.text as string,
        provider: actualProvider,
        model: result.model as string,
        memory: memoryUsage,
        ...(knowledgeUsage?.status === "used" ? { sources: knowledgeUsage.sources } : {}),
      };
      setMessages((current) => [...current, assistantMessage].slice(-MAX_MESSAGES));
      setRetryRequest(null);
      const reason = result.routing?.reason;
      setTimeline({
        state: "success",
        resolvedProvider: actualProvider,
        model: result.model,
        memory: memoryUsage,
        ...(typeof reason === "string" && [
          "local_provider_available", "cloud_provider_fallback", "cloud_provider_selected",
          "privacy_local_only", "fallback_after_provider_error",
        ].includes(reason) ? { reason: reason as RoutingReason } : {}),
      });
      if (stillCurrent() && suggestionsEnabledRef.current) void requestCandidates(request, generation);
    } catch (error) {
      if (!stillCurrent()) return;
      const code = asGatewayErrorCode(error instanceof Error ? error.message : undefined);
      setErrorCode(code);
      setRetryRequest(request);
      setTimeline({ state: "error", code });
    } finally {
      if (generation === chatGeneration.current && mounted.current) {
        chatController.current = null;
        sendingRef.current = false;
        setIsSending(false);
      }
    }
  }

  function sendDraft() {
    const content = draft.trim();
    const query = knowledgeQuery.trim();
    if (!content || content.length > MAX_MESSAGE_CHARACTERS
      || (knowledgeEnabled && (!query || query.length > MAX_SEARCH_QUERY_CHARS || !/^[\p{L}\p{M}\p{N} ]+$/u.test(query)))
      || (selectedProvider !== "auto" && !selectedStatus?.configured)
      || providersLoading || providersError || isSending || sendingRef.current || retryRequest) return;

    // Invalidate an older extraction at the start of the new round, before chat resolves.
    resetCandidates();

    const userMessage: AgentChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };
    const nextMessages = [...messages, userMessage];
    const request: RetryRequest = {
      provider: selectedProvider,
      routingPreference,
      messages: providerRequestMessages(nextMessages),
      ...(knowledgeEnabled ? { knowledge: { enabled: true as const, query } } : {}),
    };
    setMessages(nextMessages.slice(-MAX_MESSAGES));
    setDraft("");
    setRetryRequest(request);
    void sendRequest(request);
  }

  async function createPlan() {
    const content = draft.trim();
    if (!mounted.current || planningActive.current || executingRef.current || !content || content.length > MAX_PLAN_TASK_CHARS
      || (selectedProvider !== "auto" && !selectedStatus?.configured)
      || providersLoading || providersError || isSending || retryRequest) return;

    planningActive.current = true;
    const generation = ++planningGeneration.current;
    const controller = new AbortController();
    planningController.current = controller;
    const stillCurrent = () => mounted.current && generation === planningGeneration.current && !controller.signal.aborted;
    const provider = selectedProvider;
    const preference = routingPreference;
    setPlanning({ status: "generating" });
    try {
      const response = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          provider,
          ...(provider === "auto" ? { routingPreference: preference } : {}),
          messages: [{ role: "user", content }],
        }),
      });
      if (!stillCurrent()) return;
      const body: unknown = await response.json();
      if (!stillCurrent()) return;
      if (!response.ok) {
        const error = typeof body === "object" && body !== null
          ? (body as { error?: { code?: unknown } }).error : undefined;
        setPlanning({ status: "error", code: asGatewayErrorCode(error?.code) });
        return;
      }
      const rawPlan = typeof body === "object" && body !== null ? (body as { plan?: unknown }).plan : undefined;
      const planAuthorization = typeof body === "object" && body !== null
        ? (body as { planAuthorization?: unknown }).planAuthorization : undefined;
      const plan = rawPlan && typeof rawPlan === "object" ? parseAgentPlanText(JSON.stringify(rawPlan)) : null;
      setPlanning(plan ? { status: "pending", plan,
        planAuthorization: typeof planAuthorization === "string" && planAuthorization ? planAuthorization : null,
      } : { status: "error", code: "PROVIDER_ERROR" });
    } catch {
      if (stillCurrent()) setPlanning({ status: "error", code: "PROVIDER_ERROR" });
    } finally {
      if (generation === planningGeneration.current) {
        planningController.current = null;
        planningActive.current = false;
      }
    }
  }

  function cancelPlan() {
    planningGeneration.current += 1;
    planningController.current?.abort();
    planningController.current = null;
    planningActive.current = false;
    setPlanning({ status: "cancelled" });
  }

  async function confirmPlan(plan: AgentPlan, planAuthorization: string) {
    if (!mounted.current || executingRef.current) return;
    executingRef.current = true;
    const generation = ++planningGeneration.current;
    const controller = new AbortController();
    planningController.current = controller;
    const stillCurrent = () => mounted.current && generation === planningGeneration.current && !controller.signal.aborted;
    setPlanning({ status: "executing", plan });
    try {
      const confirmation = await fetch("/api/agent/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ planAuthorization, plan }),
      });
      if (!stillCurrent()) return;
      const confirmationBody: unknown = await confirmation.json();
      if (!stillCurrent()) return;
      if (!confirmation.ok) {
        const code = typeof confirmationBody === "object" && confirmationBody !== null
          ? (confirmationBody as { error?: { code?: unknown } }).error?.code : undefined;
        setPlanning({ status: "error", code: asGatewayErrorCode(code), phase: "execution" });
        return;
      }
      const authorization = typeof confirmationBody === "object" && confirmationBody !== null
        ? (confirmationBody as { authorization?: unknown }).authorization : undefined;
      if (typeof authorization !== "string" || !authorization) throw new Error("invalid confirmation");
      const response = await fetch("/api/agent/execute", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ authorization }),
      });
      if (!stillCurrent()) return;
      const body: unknown = await response.json();
      if (!stillCurrent()) return;
      if (!response.ok) {
        const code = typeof body === "object" && body !== null
          ? (body as { error?: { code?: unknown } }).error?.code : undefined;
        setPlanning({ status: "error", code: asGatewayErrorCode(code), phase: "execution" });
        return;
      }
      const result = typeof body === "object" && body !== null ? (body as { result?: unknown }).result : undefined;
      const toolResult = typeof result === "object" && result !== null
        ? result as { tool?: unknown; ok?: unknown; data?: { iso?: unknown } } : null;
      const iso = toolResult?.data?.iso;
      if (toolResult?.tool !== "read_current_time" || toolResult.ok !== true || typeof iso !== "string"
        || !Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString() !== iso) throw new Error("invalid tool result");
      setPlanning({ status: "completed", plan, iso });
    } catch {
      if (stillCurrent()) setPlanning({ status: "error", code: "PROVIDER_ERROR", phase: "execution" });
    } finally {
      if (generation === planningGeneration.current) {
        planningController.current = null;
        executingRef.current = false;
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendDraft();
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing
      || event.keyCode === 229 || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    sendDraft();
  }

  function retry() {
    if (retryRequest && !isSending) void sendRequest(retryRequest);
  }

  function clearConversation() {
    if (isSending) return;
    planningGeneration.current += 1;
    planningController.current?.abort();
    planningController.current = null;
    planningActive.current = false;
    executingRef.current = false;
    setPlanning({ status: "idle" });
    setMessages([]);
    setDraft("");
    setErrorCode(null);
    setKnowledgeNoMatch(false);
    setRetryRequest(null);
    setTimeline({ state: "idle" });
    resetCandidates();
  }

  const canSend = (selectedProvider === "auto" || !!selectedStatus?.configured) && !providersLoading && !providersError
    && !isSending && !retryRequest && !!draft.trim() && draft.trim().length <= MAX_MESSAGE_CHARACTERS
    && (!knowledgeEnabled || (!!knowledgeQuery.trim() && knowledgeQuery.trim().length <= MAX_SEARCH_QUERY_CHARS
      && /^[\p{L}\p{M}\p{N} ]+$/u.test(knowledgeQuery.trim())));
  const canPlan = (selectedProvider === "auto" || !!selectedStatus?.configured) && !providersLoading && !providersError
    && !isSending && !retryRequest && planning.status !== "generating" && planning.status !== "executing" && !!draft.trim()
    && draft.trim().length <= MAX_PLAN_TASK_CHARS;

  return (
    <>
      <PageHeader
        eyebrow="PERSONAL AI · CHAT WORKSPACE"
        title="Agent 工作空间"
        description="选择模型，与 Personal AI Assistant 开始一段真实对话。"
        action={<span className="badge">AI Gateway · 实时请求</span>}
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <p className="text-xs text-slate-400">当前会话 · 仅保存在本页面内存</p>
              <h2 className="mt-1 font-semibold">Personal AI Chat</h2>
              <p className="mt-1 text-xs text-slate-400">刷新页面后，对话内容会清空。</p>
            </div>
            <button
              type="button"
              className="button-secondary"
              disabled={isSending}
              onClick={clearConversation}
            >
              清空对话
            </button>
          </div>

          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <AgentProviderSelector
              providers={providers}
              selectedProvider={selectedProvider}
              routingPreference={routingPreference}
              loading={providersLoading}
              loadError={providersError}
              locked={isSending || !!retryRequest}
              onChange={setSelectedProvider}
              onRoutingPreferenceChange={setRoutingPreference}
            />
          </div>

          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={memorySuggestionsEnabled} onChange={(event) => {
                suggestionsEnabledRef.current = event.target.checked;
                setMemorySuggestionsEnabled(event.target.checked);
                if (!event.target.checked) resetCandidates();
              }} />
              智能记忆建议
            </label>
            <p className="mt-1 text-xs leading-5 text-slate-500">默认关闭。开启后，每次成功回复会额外分析本轮消息；云端模型会多消耗一次云端使用额度。候选仅在你确认后保存。</p>
          </div>

          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={knowledgeEnabled} disabled={isSending || !!retryRequest}
                onChange={(event) => { setKnowledgeEnabled(event.target.checked); setKnowledgeNoMatch(false); }} />
              使用我的知识库
            </label>
            <p className="mt-1 text-xs leading-5 text-slate-500">仅检索当前账号已就绪的文档。Auto 可能将本次检索片段发给最终选中的云模型；Privacy 只使用本地 Ollama。</p>
            {knowledgeEnabled && (
              <label className="mt-3 block text-xs text-slate-600">检索关键词
                <input type="text" value={knowledgeQuery} maxLength={MAX_SEARCH_QUERY_CHARS}
                  disabled={isSending || !!retryRequest} onChange={(event) => setKnowledgeQuery(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" placeholder="输入关键词" />
              </label>
            )}
          </div>

          <div
            className="flex min-h-[360px] max-h-[65vh] flex-col gap-5 overflow-y-auto p-5 sm:min-h-[440px] sm:p-6"
            aria-label="对话消息"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="m-auto max-w-md py-10 text-center">
                <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-teal-50 text-xl text-teal-800" aria-hidden="true">✦</span>
                <h3 className="mt-4 font-semibold">从你现在要做的事开始</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  输入问题后，消息会通过已登录的 AI Gateway 发送给当前选择的模型。
                </p>
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  可在服务端安全使用当前账号的 Personal Memory；仅在主动开启知识库后检索文档，不执行工具。
                </p>
              </div>
            ) : messages.map((message) => (
              <AgentMessage key={message.id} message={message} />
            ))}

            {isSending && (
              <div className="flex items-start gap-3" role="status" aria-live="polite">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-800" aria-hidden="true">✦</span>
                <div className="rounded-2xl rounded-tl-sm bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  AI 正在响应…
                </div>
              </div>
            )}

            {errorCode && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
                <p className="text-sm font-medium text-red-800">{errorMessages[errorCode]}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {errorCode === "AUTH_REQUIRED" ? (
                    <Link href="/login" className="button-secondary">重新登录</Link>
                  ) : (
                    <button type="button" className="button-secondary" disabled={isSending} onClick={retry}>
                      重试
                    </button>
                  )}
                  <button type="button" className="button-secondary" disabled={isSending} onClick={clearConversation}>
                    清空对话
                  </button>
                </div>
              </div>
            )}
            {knowledgeNoMatch && <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">没有找到相关知识库片段，请修改关键词。本次没有调用 AI 模型。</p>}
          </div>

          {planning.status !== "idle" && (
            <section className="border-t border-slate-100 p-5 sm:p-6" aria-label="任务计划">
              <h3 className="text-sm font-semibold text-slate-800">任务计划</h3>
              {planning.status === "generating" && (
                <p className="mt-3 text-sm text-slate-500" role="status">正在制定计划…</p>
              )}
              {(planning.status === "pending" || planning.status === "executing" || planning.status === "completed") && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  {planning.status === "pending" && <p className="mb-2 text-xs font-medium text-amber-700">计划待确认，不会自动执行。</p>}
                  {planning.status === "pending" && <p className="mb-2 text-xs text-slate-500">确认后仅演示读取当前 UTC 时间；计划步骤仍保持待执行。</p>}
                  {planning.status === "pending" && !planning.planAuthorization && <p className="mb-2 text-xs text-amber-700">当前环境未配置执行授权，仍可查看或取消计划。</p>}
                  <p className="text-sm font-medium text-slate-800">{planning.plan.goal}</p>
                  <ol className="mt-3 list-decimal space-y-3 pl-5">
                    {planning.plan.steps.map((step) => (
                      <li key={step.id} className="text-sm text-slate-700">
                        <p className="font-medium">{step.title} <span className="text-xs font-normal text-slate-400">待执行</span></p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-500">{step.description}</p>
                      </li>
                    ))}
                  </ol>
                  {planning.status === "pending" ? (
                    <div className="mt-4 flex gap-2">
                      <button type="button" className="button-primary" disabled={!planning.planAuthorization}
                        onClick={() => { if (planning.planAuthorization) void confirmPlan(planning.plan, planning.planAuthorization); }}>确认计划</button>
                      <button type="button" className="button-secondary" onClick={cancelPlan}>取消</button>
                    </div>
                  ) : planning.status === "executing"
                    ? <p className="mt-4 text-xs font-medium text-teal-700" role="status">计划已确认，正在执行只读工具…</p>
                    : <div className="mt-4 text-xs font-medium text-teal-700" role="status">
                      <p>计划已确认。只读工具执行成功。</p>
                      <p>使用的 Tool：read_current_time</p>
                      <p>当前 UTC 时间：{planning.iso}</p>
                    </div>}
                </div>
              )}
              {planning.status === "cancelled" && <p className="mt-3 text-sm text-slate-500" role="status">计划已取消。</p>}
              {planning.status === "error" && (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
                  <p className="text-sm text-red-800">{planning.phase === "execution" && planning.code !== "AUTH_REQUIRED"
                    ? "计划执行失败，请稍后重试。" : errorMessages[planning.code]}</p>
                  {planning.code === "AUTH_REQUIRED" && <Link href="/login" className="mt-3 inline-block text-sm text-red-800 underline">重新登录</Link>}
                </div>
              )}
            </section>
          )}

          {(extractingCandidates || candidateError || candidates.length > 0) && (
            <section className="border-t border-slate-100 p-5 sm:p-6" aria-label="智能记忆候选">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">智能记忆建议</h3>
                <Link href="/memory" className="text-xs font-medium text-teal-700 hover:text-teal-900">管理个人记忆</Link>
              </div>
              {extractingCandidates && <p className="mt-2 text-xs text-slate-500" role="status">正在分析本轮消息…</p>}
              {candidateError && <p className="mt-2 text-xs text-amber-700">本次记忆建议未生成，聊天回复不受影响。</p>}
              <div className="mt-3 space-y-3">
                {candidates.map((candidate) => (
                  <div key={candidate.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm text-slate-800">{candidate.content}</p>
                    <p className="mt-1 text-xs text-slate-500">{candidate.reason}</p>
                    <div className="mt-3 flex gap-2">
                      {candidate.status === "saved" ? <span className="text-xs text-teal-700">已保存到 Personal Memory</span> : candidate.status === "duplicate" ? <span className="text-xs text-amber-700">已有相同记忆，未重复保存。</span> : (
                        <>
                          <button type="button" className="button-primary" disabled={candidate.status === "saving"} onClick={() => void saveCandidate(candidate)}>
                            {candidate.status === "saving" ? "保存中…" : candidate.status === "error" ? "重试保存" : "确认保存"}
                          </button>
                          <button type="button" className="button-secondary" disabled={candidate.status === "saving"} onClick={() => setCandidates((current) => current.filter((entry) => entry.id !== candidate.id))}>忽略</button>
                          {candidate.status === "error" && <span className="self-center text-xs text-red-700">保存失败，可重试。</span>}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <form onSubmit={submit} className="border-t border-slate-100 p-5 sm:p-6">
            <label htmlFor="agent-message" className="mb-2 block text-xs font-medium text-slate-500">
              发送消息
            </label>
            <textarea
              id="agent-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleDraftKeyDown}
              maxLength={MAX_MESSAGE_CHARACTERS}
              rows={3}
              disabled={isSending || !!retryRequest || providersLoading || providersError}
              placeholder="输入你想讨论的问题…"
              aria-describedby="agent-message-hint"
              className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 disabled:opacity-60"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p id="agent-message-hint" className="text-xs text-slate-400">
                Enter 发送 · Shift+Enter 换行 · 最多 {MAX_MESSAGE_CHARACTERS} 字符 · 最近 {MAX_MESSAGES} 条消息作为上下文 · {draft.length}/{MAX_MESSAGE_CHARACTERS}
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={!canPlan} className="button-secondary" onClick={() => void createPlan()}>
                  {planning.status === "generating" ? "正在制定计划…" : "制定计划"}
                </button>
                <button type="submit" disabled={!canSend} className="button-primary">
                  {isSending ? "AI 正在响应…" : "发送消息 ↑"}
                </button>
              </div>
            </div>
            {draft.trim().length > MAX_PLAN_TASK_CHARS && (
              <p className="mt-3 text-xs text-amber-700">制定计划的任务最多 {MAX_PLAN_TASK_CHARS} 字符。</p>
            )}
            {!providersLoading && !providersError && selectedProvider !== "auto" && !selectedStatus?.configured && (
              <p className="mt-3 text-xs text-amber-700">
                {providerLabels[selectedProvider]} 尚未配置。请切换到可用 Provider。
              </p>
            )}
            {draft.trim().length > MAX_MESSAGE_CHARACTERS && (
              <p className="mt-3 text-xs text-red-700">单条消息超过 Gateway 限制，请缩短后发送。</p>
            )}
          </form>
        </section>

        <div className="space-y-4">
          <AgentTimeline
            state={timeline}
            provider={selectedProvider}
            model={selectedStatus?.model}
          />
          <section className="panel">
            <h2 className="text-sm font-semibold">当前能力边界</h2>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-500">
              <li>✓ 通过 AI Gateway 调用所选 Provider</li>
              <li>✓ 当前页面内存中的多轮对话</li>
              <li>✓ Memory Context 在服务端按账号隔离并限制注入数量</li>
              <li>✓ 可主动开启知识库关键词辅助回答，并显示实际来源</li>
              <li>○ 语义 RAG 与工具执行尚未接入</li>
              <li>○ Local Connector 尚未实现</li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
