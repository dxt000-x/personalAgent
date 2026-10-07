import { AgentStep, type ExecutionStep, type StepStatus } from "./agent-step";
import type { ProviderId } from "@/lib/ai/types";

type TimelineState =
  | { state: "idle" | "running" | "success" }
  | { state: "error"; code: string };

const providerNames: Record<ProviderId, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
};

export function AgentTimeline({
  state,
  provider,
  model,
}: {
  state: TimelineState;
  provider: ProviderId;
  model?: string;
}) {
  const failedIndex = state.state === "error"
    ? state.code === "INVALID_REQUEST" || state.code === "AUTH_REQUIRED"
      ? 1
      : state.code === "PROVIDER_NOT_CONFIGURED"
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

  const descriptions = [
    "收到本次用户消息",
    "Gateway 校验身份与消息限制",
    `选择 ${providerNames[provider]}${model ? ` · ${model}` : ""}`,
    "等待所选模型生成回复",
    state.state === "success" ? "已收到模型回复" : "模型回复完成后显示",
  ];

  const steps: ExecutionStep[] = [
    "Received",
    "Validating",
    "Selecting Provider",
    "Generating",
    "Completed",
  ].map((title, index) => ({ title, description: descriptions[index], status: statuses[index] }));

  return (
    <section className="panel">
      <p className="text-xs text-slate-400">AI GATEWAY REQUEST</p>
      <h2 className="mt-1 text-lg font-semibold">请求过程</h2>
      <p className="mb-6 mt-2 text-xs leading-5 text-slate-400">
        展示本次前端请求状态；不表示已执行 Agent Planning、Memory、RAG 或工具。
      </p>
      <ol aria-label="AI Gateway 请求状态">
        {steps.map((step, index) => (
          <AgentStep key={step.title} step={step} last={index === steps.length - 1} />
        ))}
      </ol>
    </section>
  );
}
