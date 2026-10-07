import type { ProviderId, ProviderStatus } from "@/lib/ai/types";

const providerNames: Record<ProviderId, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
};

const providerOrder: ProviderId[] = ["ollama", "openai", "deepseek", "gemini"];

export function AgentProviderSelector({
  providers,
  selectedProvider,
  loading,
  loadError,
  locked,
  onChange,
}: {
  providers: ProviderStatus[];
  selectedProvider: ProviderId;
  loading: boolean;
  loadError: boolean;
  locked: boolean;
  onChange: (provider: ProviderId) => void;
}) {
  const selected = providers.find(({ id }) => id === selectedProvider);

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-48 flex-1">
        <label htmlFor="agent-provider" className="mb-2 block text-xs font-medium text-slate-500">
          Provider
        </label>
        <select
          id="agent-provider"
          value={selectedProvider}
          disabled={loading || loadError || locked}
          onChange={(event) => onChange(event.target.value as ProviderId)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:opacity-60"
        >
          {providerOrder.map((id) => {
            const status = providers.find((provider) => provider.id === id);
            const state = !status?.configured ? "Not configured" : id === "ollama" ? "Ready" : "Configured";
            return (
              <option key={id} value={id}>
                {providerNames[id]} · {state}
              </option>
            );
          })}
        </select>
        <p className="mt-2 text-xs text-slate-400">
          {loading
            ? "正在读取 Provider 配置…"
            : loadError
              ? "Provider 状态加载失败，请刷新页面重试。"
              : selected
                ? `${selected.model} · 配置状态不代表上游服务健康状态`
                : "尚无 Provider 配置信息"}
        </p>
      </div>
      <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
        当前模型 <span className="ml-1 font-medium text-slate-700">{selected?.model ?? "—"}</span>
      </div>
    </div>
  );
}
