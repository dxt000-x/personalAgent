import { chineseOverrides, english } from "./messages";

export type Locale = "zh-CN" | "en";
export const DEFAULT_LOCALE: Locale = "zh-CN";
export const isLocale = (value: unknown): value is Locale => value === "zh-CN" || value === "en";
export function preferenceKey(userId: string | null): string {
  return `personal-agent:locale:v1:${userId ? encodeURIComponent(userId) : "guest"}`;
}
export function browserLocale(languages: readonly string[]): Locale {
  for (const value of languages) {
    if (/^zh(?:-|$)/iu.test(value)) return "zh-CN";
    if (/^en(?:-|$)/iu.test(value)) return "en";
  }
  return DEFAULT_LOCALE;
}
export function resolveLocale(saved: unknown, languages: readonly string[]): Locale {
  return isLocale(saved) ? saved : browserLocale(languages);
}
export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function formatDate(value: string | Date, locale: Locale, options: Intl.DateTimeFormatOptions = {}): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC", ...options,
  }).format(date) : "—";
}
export function translate(source: string, locale: Locale, values: Record<string, string | number> = {}): string {
  if (!source) return "";
  const requestError = /^请求失败（(\d+)）。请稍后重试。$/u.exec(source);
  if (requestError) return translate("请求失败（{0}）。请稍后重试。", locale, { 0: requestError[1] });
  const message = locale === "en" ? english[source] ?? source : chineseOverrides[source] ?? source;
  return message.replace(/\{(\d+|[a-zA-Z_]+)\}/gu, (token, key: string) =>
    Object.hasOwn(values, key) ? typeof values[key] === "number" ? formatNumber(values[key], locale) : values[key] : token);
}
export function translateError(source: string, locale: Locale): string {
  return Object.hasOwn(english, source) || /^请求失败（\d+）。请稍后重试。$/u.test(source)
    ? translate(source, locale) : translate("请求未能完成，请稍后重试。", locale);
}

export type LocaleSnapshot = { locale: Locale; storageBlocked: boolean };
export const SERVER_LOCALE_SNAPSHOT: LocaleSnapshot = Object.freeze({ locale: DEFAULT_LOCALE, storageBlocked: false });
// Per-provider store: no module-wide user preference, document text or auth data.
export function createLocaleStore(userId: string | null) {
  let snapshot = SERVER_LOCALE_SNAPSHOT;
  const listeners = new Set<() => void>();
  const key = preferenceKey(userId);
  const emit = (locale: Locale, storageBlocked: boolean) => {
    if (snapshot.locale === locale && snapshot.storageBlocked === storageBlocked) return;
    snapshot = { locale, storageBlocked };
    for (const listener of listeners) listener();
  };
  const initialize = () => {
    let saved: string | null = null, blocked = false;
    try { saved = window.localStorage.getItem(key); } catch { blocked = true; }
    emit(resolveLocale(saved, navigator.languages?.length ? navigator.languages : [navigator.language]), blocked);
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_LOCALE_SNAPSHOT,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize,
    setLocale: (value: Locale) => {
      if (!isLocale(value)) return;
      let blocked = false;
      try { window.localStorage.setItem(key, value); } catch { blocked = true; }
      emit(value, blocked);
    },
    storageEvent: (event: StorageEvent) => { if (event.key === key || event.key === null) initialize(); },
  };
}
