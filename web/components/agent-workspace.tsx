"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { PageHeader } from "./page-header";
import { AgentTimeline } from "./agent-timeline";
import { AgentMessage, type AgentChatMessage } from "./agent-message";
import { AgentProviderSelector } from "./agent-provider-selector";
import type { ChatMessage, MemoryUsage, ProviderId, ProviderSelection, ProviderStatus, RoutingPreference, RoutingReason } from "@/lib/ai/types";
import {
  MAX_INPUT_CHARACTERS,
  MAX_MESSAGE_CHARACTERS,
  MAX_MESSAGES,
} from "@/lib/ai/limits";

type GatewayErrorCode =
  | "AUTH_REQUIRED"
  | "PROVIDER_NOT_CONFIGURED"
  | "PRIVACY_PROVIDER_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT";

type RetryRequest = { provider: ProviderSelection; routingPreference: RoutingPreference; messages: ChatMessage[] };
type TimelineState =
  | { state: "idle" | "running" | "success"; resolvedProvider?: ProviderId; model?: string; reason?: RoutingReason; memory?: MemoryUsage }
  | { state: "error"; code: GatewayErrorCode };

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
  PROVIDER_ERROR: "模型服务暂时不可用。请检查 Provider 服务状态后重试。",
  RATE_LIMITED: "请求过于频繁，请稍后重试。",
  TIMEOUT: "模型响应超时，请稍后重试。",
};

const gatewayErrorCodes = new Set<GatewayErrorCode>([
  "AUTH_REQUIRED",
  "PROVIDER_NOT_CONFIGURED",
  "PRIVACY_PROVIDER_UNAVAILABLE",
  "INVALID_REQUEST",
  "PROVIDER_ERROR",
  "RATE_LIMITED",
  "TIMEOUT",
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

export function AgentWorkspace({ sessionKey = "default" }: { sessionKey?: string }) {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderSelection>("auto");
  const [routingPreference, setRoutingPreference] = useState<RoutingPreference>("auto");
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorCode, setErrorCode] = useState<GatewayErrorCode | null>(null);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [timeline, setTimeline] = useState<TimelineState>({ state: "idle" });
  const sendingRef = useRef(false);

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

  async function sendRequest(request: RetryRequest) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);
    setErrorCode(null);
    setTimeline({ state: "running" });
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: request.provider,
          ...(request.provider === "auto" ? { routingPreference: request.routingPreference } : {}),
          messages: request.messages,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const error = typeof body === "object" && body !== null
          ? (body as { error?: { code?: unknown } }).error
          : undefined;
        throw new Error(asGatewayErrorCode(error?.code));
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
    } catch (error) {
      const code = asGatewayErrorCode(error instanceof Error ? error.message : undefined);
      setErrorCode(code);
      setRetryRequest(request);
      setTimeline({ state: "error", code });
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  function sendDraft() {
    const content = draft.trim();
    if (!content || content.length > MAX_MESSAGE_CHARACTERS
      || (selectedProvider !== "auto" && !selectedStatus?.configured)
      || providersLoading || providersError || isSending || sendingRef.current || retryRequest) return;

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
    };
    setMessages(nextMessages.slice(-MAX_MESSAGES));
    setDraft("");
    setRetryRequest(request);
    void sendRequest(request);
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
    setMessages([]);
    setDraft("");
    setErrorCode(null);
    setRetryRequest(null);
    setTimeline({ state: "idle" });
  }

  const canSend = (selectedProvider === "auto" || !!selectedStatus?.configured) && !providersLoading && !providersError
    && !isSending && !retryRequest && !!draft.trim() && draft.trim().length <= MAX_MESSAGE_CHARACTERS;

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
                  可在服务端安全使用当前账号的 Personal Memory 作为回答上下文，不会自动读取知识库或执行工具。
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
          </div>

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
              <button type="submit" disabled={!canSend} className="button-primary">
                {isSending ? "AI 正在响应…" : "发送消息 ↑"}
              </button>
            </div>
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
              <li>○ RAG 与工具执行尚未接入</li>
              <li>○ Local Connector 尚未实现</li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
