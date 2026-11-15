import { describe, expect, it } from "vitest";
import { browserLocale, preferenceKey, resolveLocale, translate, translateError, formatDate, formatNumber } from "./core";
describe("account-scoped i18n primitives", () => {
  it("uses saved preference before browser language and Chinese fallback", () => {
    expect(resolveLocale("en", ["zh-CN"])).toBe("en"); expect(resolveLocale("zh-CN", ["en-US"])).toBe("zh-CN");
    expect(resolveLocale("invalid", ["fr-FR", "en-GB"])).toBe("en"); expect(browserLocale(["zh-TW", "en"])).toBe("zh-CN");
    expect(resolveLocale(null, ["fr"])).toBe("zh-CN"); expect(resolveLocale(null, [])).toBe("zh-CN");
  });
  it("uses independent keys for different accounts and signed-out visitors", () => {
    expect(new Set([preferenceKey("A"), preferenceKey("B"), preferenceKey(null)]).size).toBe(3);
    expect(preferenceKey("a:b")).toContain("a%3Ab");
  });
  it("translates navigation and parameterized counts without touching provider identifiers", () => {
    expect(translate("Dashboard", "zh-CN")).toBe("工作台"); expect(translate("Dashboard", "en")).toBe("Dashboard");
    expect(translate("使用 {0} 条个人记忆", "en", { 0: 3 })).toBe("Using 3 personal memories");
    expect(translate("OpenAI", "zh-CN")).toBe("OpenAI");
  });
  it("localizes safe errors and suppresses arbitrary backend messages", () => {
    expect(translateError("password=PRIVATE_CANARY", "en")).toBe("The request could not be completed. Try again later.");
    expect(translate("请求失败（503）。请稍后重试。", "en")).toBe("Request failed (503). Try again later.");
  });
  it("formats dates and numeric/percentage values through the corresponding Intl locale", () => {
    expect(formatDate("2026-11-13T12:00:00Z", "en")).not.toBe(formatDate("2026-11-13T12:00:00Z", "zh-CN"));
    expect(formatDate("invalid", "en")).toBe("—"); expect(formatNumber(0.82, "en", { style: "percent" })).toBe("82%");
    expect(formatNumber(12345, "en")).toBe(new Intl.NumberFormat("en").format(12345));
  });
});
