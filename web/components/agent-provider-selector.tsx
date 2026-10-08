import type { ProviderId, ProviderSelection, ProviderStatus, RoutingPreference } from "@/lib/ai/types";

const providerNames: Record<ProviderId, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

const providerOrder: ProviderId[] = ["ollama", "openrouter", "openai", "deepseek", "gemini"];

export function AgentProviderSelector({
  providers,
  selectedProvider,
  routingPreference,
  loading,
  loadError,
  locked,
  onChange,
  onRoutingPreferenceChange,
}: {
  providers: ProviderStatus[];
  selectedProvider: ProviderSelection;
  routingPreference: RoutingPreference;
  loading: boolean;
  loadError: boolean;
  locked: boolean;
  onChange: (provider: ProviderSelection) => void;
  onRoutingPreferenceChange: (preference: RoutingPreference) => void;
}) {
  const selected = selectedProvider === "auto" ? undefined : providers.find(({ id }) => id === selectedProvider);

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-48 flex-1">
        <label htmlFor="agent-provider" className="mb-2 block text-xs font-medium text-slate-500">Provider</label>
        <select
          id="agent-provider"
          value={selectedProvider}
          disabled={loading || loadError || locked}
          onChange={(event) => onChange(event.target.value as ProviderSelection)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:opacity-60"
        >
          <option value="auto">Auto · Recommended</option>
          {providerOrder.map((id) => {
            const status = providers.find((provider) => provider.id === id);
            const state = !status?.configured
              ? "Not configured"
              : `Configured · ${status.availability === "available"
                ? "Available"
                : status.availability === "unavailable"
                  ? "Unavailable"
                  : "Health unknown"}`;
            return <option key={id} value={id}>{providerNames[id]} · {status?.type === "local" ? "Local" : "Cloud"} · {state}</option>;
          })}
        </select>
        {selectedProvider === "auto" && (
          <div className="mt-3">
            <label htmlFor="agent-routing-preference" className="mb-2 block text-xs font-medium text-slate-500">自动路由偏好</label>
            <select
              id="agent-routing-preference"
              value={routingPreference}
              disabled={loading || loadError || locked}
              onChange={(event) => onRoutingPreferenceChange(event.target.value as RoutingPreference)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:opacity-60"
            >
              <option value="auto">Auto · 可用时优先本地，必要时云端</option>
              <option value="privacy">Privacy · 仅使用本地模型</option>
            </select>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">
          {loading
            ? "正在读取 Provider 配置与本地健康状态…"
            : loadError
              ? "Provider 状态加载失败，请刷新页面重试。"
              : selectedProvider === "auto"
                ? "规则路由；云 Provider 健康状态未知，实际调用失败时最多尝试两个候选。"
                : selected
                  ? `${selected.model} · ${selected.availability === "unknown" ? "上游健康状态未知" : selected.availability === "available" ? "当前可用" : "当前不可用"}`
                  : "尚无 Provider 配置信息"}
        </p>
        {selectedProvider !== "auto" && routingPreference === "privacy" && (
          <p className="mt-2 text-xs text-amber-700">
            当前为显式 Provider，Privacy 自动路由偏好不生效；选择云端模型会向云端发送消息。
          </p>
        )}
      </div>
      <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
        {selectedProvider === "auto" ? "首选策略" : "当前模型"}
        <span className="ml-1 font-medium text-slate-700">{selected?.model ?? (routingPreference === "privacy" ? "仅本地" : "本地优先")}</span>
      </div>
    </div>
  );
}
