"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createLocaleStore, DEFAULT_LOCALE, formatDate, formatNumber, translate, translateError, type Locale } from "@/lib/i18n/core";

type I18n = { locale: Locale; storageBlocked: boolean; setLocale: (locale: Locale) => void;
  t: (source: string, values?: Record<string, string | number>) => string; errorText: (source: string) => string;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  date: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string };
const fallback: I18n = { locale: DEFAULT_LOCALE, storageBlocked: false, setLocale: () => undefined,
  t: (source, values) => translate(source, DEFAULT_LOCALE, values), errorText: (source) => translateError(source, DEFAULT_LOCALE),
  number: (value, options) => formatNumber(value, DEFAULT_LOCALE, options), date: (value, options) => formatDate(value, DEFAULT_LOCALE, options) };
const Context = createContext<I18n>(fallback);

export function I18nProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const store = useMemo(() => createLocaleStore(userId), [userId]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => {
    store.initialize();
    window.addEventListener("storage", store.storageEvent);
    return () => window.removeEventListener("storage", store.storageEvent);
  }, [store]);
  useEffect(() => { document.documentElement.lang = snapshot.locale; }, [snapshot.locale]);
  const t = useCallback((source: string, values?: Record<string, string | number>) => translate(source, snapshot.locale, values), [snapshot.locale]);
  const value = useMemo<I18n>(() => ({ ...snapshot, setLocale: store.setLocale, t,
    errorText: (source) => translateError(source, snapshot.locale),
    number: (value, options) => formatNumber(value, snapshot.locale, options),
    date: (value, options) => formatDate(value, snapshot.locale, options) }), [snapshot, store, t]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useI18n = () => useContext(Context);
export function UiText({ source }: { source: string }) { return <>{useI18n().t(source)}</>; }
export function LanguageSwitcher() {
  const { locale, setLocale, t, storageBlocked } = useI18n();
  const id = useId();
  return <div className="min-w-0">
    <label htmlFor={id} className="block text-xs font-semibold text-slate-600">{t("界面语言")}</label>
    <select id={id} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}
      className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800">
      <option value="zh-CN">中文</option><option value="en">English</option>
    </select>
    {storageBlocked && <p role="status" className="mt-2 text-xs text-amber-800">{t("浏览器阻止了本地保存；本次选择仅在当前页面生效。")}</p>}
  </div>;
}
