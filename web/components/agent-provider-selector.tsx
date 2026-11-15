"use client";

import { useI18n } from "@/components/i18n-provider";

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
  const { t } = useI18n();
  const selected = selectedProvider === "auto" ? undefined : providers.find(({ id }) => id === selectedProvider);

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 basis-full sm:basis-auto sm:min-w-48 sm:flex-1">
        <label htmlFor="agent-provider" className="mb-2 block text-xs font-medium text-slate-500">{t("Provider")}</label>
        <select
          id="agent-provider"
          value={selectedProvider}
          disabled={loading || loadError || locked}
          onChange={(event) => onChange(event.target.value as ProviderSelection)}
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:opacity-60"
        >
          <option value="auto">{t("Auto · Recommended")}</option>
          {providerOrder.map((id) => {
            const status = providers.find((provider) => provider.id === id);
            const state = !status?.configured
              ? "Not configured"
              : t("Configured · {0}", {0: (status.availability === "available"
                ? t("Available")
                : status.availability === "unavailable"
                  ? t("Unavailable")
                  : t("Health unknown"))});
            return <option key={id} value={id}>{providerNames[id]} · {status?.type === "local" ? t("Local") : t("Cloud")} · {t(state)}</option>;
          })}
        </select>
        {selectedProvider === "auto" && (
          <div className="mt-3">
            <label htmlFor="agent-routing-preference" className="mb-2 block text-xs font-medium text-slate-500">{t("自动路由偏好")}</label>
            <select
              id="agent-routing-preference"
              value={routingPreference}
              disabled={loading || loadError || locked}
              onChange={(event) => onRoutingPreferenceChange(event.target.value as RoutingPreference)}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:opacity-60"
            >
              <option value="auto">{t("Auto · 可用时优先本地，必要时云端")}</option>
              <option value="privacy">{t("Privacy · 仅使用本地模型")}</option>
            </select>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">
          {loading
            ? t("正在读取 Provider 配置与本地健康状态…")
            : loadError
              ? t("Provider 状态加载失败，请刷新页面重试。")
              : selectedProvider === "auto"
                ? t("规则路由；云 Provider 健康状态未知，实际调用失败时最多尝试两个候选。")
                : selected
                  ? t("{0} · {1}", {0: (selected.model), 1: (selected.availability === "unknown" ? t("上游健康状态未知") : selected.availability === "available" ? t("当前可用") : t("当前不可用"))})
                  : t("尚无 Provider 配置信息")}
        </p>
        {selectedProvider !== "auto" && routingPreference === "privacy" && (
          <p className="mt-2 text-xs text-amber-700">
            {t("当前为显式 Provider，Privacy 自动路由偏好不生效；选择云端模型会向云端发送消息。")}</p>
        )}
      </div>
      <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
        {selectedProvider === "auto" ? t("首选策略") : t("当前模型")}
        <span className="ml-1 font-medium text-slate-700">{selected?.model ?? (routingPreference === "privacy" ? t("仅本地") : t("本地优先"))}</span>
      </div>
    </div>
  );
}
