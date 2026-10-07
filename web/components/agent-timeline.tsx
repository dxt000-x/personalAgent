import { AgentStep, type ExecutionStep, type StepStatus } from "./agent-step";
import type { ProviderId, ProviderSelection, RoutingReason } from "@/lib/ai/types";

type TimelineState =
  | { state: "idle" | "running" | "success"; resolvedProvider?: ProviderId; model?: string; reason?: RoutingReason }
  | { state: "error"; code: string };

const providerNames: Record<ProviderId, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
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
        ? 2
        : 3
    : -1;

  const statuses: StepStatus[] = state.state === "idle"
    ? ["pending", "pending", "pending", "pending", "pending"]
    : state.state === "running"
      ? ["success", "success", "success", "running", "pending"]
      : state.state === "success"
        ? ["success", "success", "success", "success", "success"]
        : [0, 1, 2, 3, 4].map((index) =>
            index < failedIndex ? "success" : index === failedIndex ? "error" : "pending",
          );

  const selectedModel = state.state === "success" && state.model ? state.model : model;
  const descriptions = [
    "收到本次用户消息",
    "Gateway 校验身份与消息限制",
    state.state === "success" && state.resolvedProvider
      ? `${provider === "auto" ? "Auto 路由到" : "明确使用"} ${providerNames[state.resolvedProvider]}${selectedModel ? ` · ${selectedModel}` : ""}${state.reason ? ` · ${reasonLabels[state.reason]}` : ""}`
      : provider === "auto"
        ? "按本地可用性、隐私偏好和固定顺序选择 Provider"
        : `使用已指定的 ${providerNames[provider]}${selectedModel ? ` · ${selectedModel}` : ""}`,
    "向最终选择的 Provider 发送请求并等待响应",
    state.state === "success" ? "已收到模型回复" : "模型回复完成后显示",
  ];

  const steps: ExecutionStep[] = ["Received", "Validating", "Routing", "Generating", "Completed"]
    .map((title, index) => ({ title, description: descriptions[index], status: statuses[index] }));

  return (
    <section className="panel">
      <p className="text-xs text-slate-400">AI GATEWAY REQUEST</p>
      <h2 className="mt-1 text-lg font-semibold">请求过程</h2>
      <p className="mb-6 mt-2 text-xs leading-5 text-slate-400">
        展示本次真实 Gateway 请求阶段；不表示已执行 Agent Planning、Memory、RAG 或工具。
      </p>
      <ol aria-label="AI Gateway 请求状态">
        {steps.map((step, index) => (
          <AgentStep key={step.title} step={step} last={index === steps.length - 1} />
        ))}
      </ol>
    </section>
  );
}
