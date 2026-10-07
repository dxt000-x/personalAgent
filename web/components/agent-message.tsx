import type { MemoryUsage, ProviderId } from "@/lib/ai/types";

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: ProviderId;
  model?: string;
  memory?: MemoryUsage;
};

const providerNames: Record<ProviderId, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
};

export function AgentMessage({ message }: { message: AgentChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-slate-100 px-4 py-3 sm:max-w-[80%]">
        <p className="mb-1 text-xs text-slate-400">你</p>
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-800">{message.content}</p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-800" aria-hidden="true">✦</span>
      <div className="min-w-0 max-w-[90%] sm:max-w-[85%]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-semibold">Personal AI</p>
          {message.provider && message.model && (
            <span className="text-xs text-slate-400">
              {providerNames[message.provider]} · {message.model}
            </span>
          )}
          {message.memory && (
            <span className="text-xs text-slate-400">
              {message.memory.status === "used"
                ? `使用 ${message.memory.count} 条个人记忆`
                : message.memory.status === "unavailable"
                  ? "Memory unavailable · 未注入记忆"
                  : message.memory.status === "omitted"
                    ? "本次未注入记忆"
                    : "未使用个人记忆"}
            </span>
          )}
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{message.content}</p>
      </div>
    </div>
  );
}
