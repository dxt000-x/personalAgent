import { AgentStep, type ExecutionStep, type StepStatus } from "./agent-step";
import type { MemoryUsage, ProviderId, ProviderSelection, RoutingReason } from "@/lib/ai/types";

type TimelineState =
  | { state: "idle" | "running" | "success"; resolvedProvider?: ProviderId; model?: string; reason?: RoutingReason; memory?: MemoryUsage }
  | { state: "error"; code: string };

const providerNames: Record<ProviderId, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

const reasonLabels: Record<RoutingReason, string> = {
  local_provider_available: "本地可用",
  cloud_provider_fallback: "本地不可用，尝试云端",
  cloud_provider_selected: "使用已配置云端",
  privacy_local_only: "Privacy 仅本地",
  fallback_after_provider_error: "前一候选失败后切换",
};

export function AgentTimeline({
  state,
  provider,
  model,
}: {
  state: TimelineState;
  provider: ProviderSelection;
  model?: string;
}) {
  const failedIndex = state.state === "error"
      ? state.code === "INVALID_REQUEST" || state.code === "AUTH_REQUIRED"
        ? 1
        : state.code === "PROVIDER_NOT_CONFIGURED" || state.code === "PRIVACY_PROVIDER_UNAVAILABLE"
        ? 3
        : 4
    : -1;

  const statuses: StepStatus[] = state.state === "idle"
    ? ["pending", "pending", "pending", "pending", "pending", "pending"]
    : state.state === "running"
      ? ["success", "success", "running", "pending", "pending", "pending"]
      : state.state === "success"
        ? ["success", "success", "success", "success", "success", "success"]
        : [0, 1, 2, 3, 4, 5].map((index) =>
            index < failedIndex ? "success" : index === failedIndex ? "error" : "pending",
          );

  const selectedModel = state.state === "success" && state.model ? state.model : model;
  const memoryDescription = state.state === "running"
    ? "按当前登录用户检索；高重要度优先，并受数量与字符预算限制"
    : state.state !== "success" || !state.memory
      ? "正在准备当前用户的安全 Memory Context"
      : state.memory.status === "used"
        ? `已使用 ${state.memory.count} 条个人记忆`
        : state.memory.status === "none"
          ? "No memory found · 继续正常对话"
          : state.memory.status === "unavailable"
            ? "Memory unavailable · 本次继续对话且不注入记忆"
            : "为满足输入限制，本次未注入记忆";
  const descriptions = [
    "收到本次用户消息",
    state.state === "running" ? "检查登录身份并校验对话输入" : "Gateway 身份验证与输入校验",
    memoryDescription,
    state.state === "success" && state.resolvedProvider
      ? `${provider === "auto" ? "Auto 路由到" : "明确使用"} ${providerNames[state.resolvedProvider]}${selectedModel ? ` · ${selectedModel}` : ""}${state.reason ? ` · ${reasonLabels[state.reason]}` : ""}`
      : provider === "auto"
        ? "Memory 检索之后，按本地可用性与隐私偏好选择 Provider"
        : `使用已指定的 ${providerNames[provider]}${selectedModel ? ` · ${selectedModel}` : ""}`,
    state.state === "success" ? "最终 Provider 已生成回复" : "只将本次请求交给最终选择的 Provider",
    state.state === "success" ? "已收到模型回复" : "模型回复完成后显示",
  ];

  const steps: ExecutionStep[] = ["Received", "Validating", "Retrieving Memory", "Routing", "Generating", "Completed"]
    .map((title, index) => ({ title, description: descriptions[index], status: statuses[index] }));

  return (
    <section className="panel">
      <p className="text-xs text-slate-400">AI GATEWAY REQUEST</p>
      <h2 className="mt-1 text-lg font-semibold">请求过程</h2>
      <p className="mb-6 mt-2 text-xs leading-5 text-slate-400">
        展示本次真实 Gateway 请求阶段。Memory 仅从当前账号读取，不进行向量检索或 RAG。
      </p>
      <ol aria-label="AI Gateway 请求状态">
        {steps.map((step, index) => (
          <AgentStep key={step.title} step={step} last={index === steps.length - 1} />
        ))}
      </ol>
    </section>
  );
}
