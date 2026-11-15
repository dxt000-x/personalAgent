import { describe, expect, it } from "vitest";
import { auditI18n } from "./check-i18n-coverage.mjs";
describe("round48 whole-site translation coverage", () => {
  it("has both locales for all static UI and safe API messages with no raw visible copy", async () => {
    const r = await auditI18n();
    expect(r.status).toBe("PASS"); expect(r.keys).toBeGreaterThanOrEqual(500);
    expect(r.missing).toEqual([]); expect(r.rawUi).toEqual([]); expect(r.placeholderMismatch).toEqual([]);
  });
  it("detects missing keys rather than presenting a partial dictionary as complete", async () => {
    const r = await auditI18n(undefined, { english: {}, chineseOverrides: {} });
    expect(r.status).toBe("FAIL"); expect(r.missing.length).toBeGreaterThan(400);
  });
  it("detects blank values, orphan overrides and lost interpolation placeholders", async () => {
    const r = await auditI18n(undefined, { english: { "x {0}": "x", blank: "" }, chineseOverrides: { orphan: "孤立" } });
    expect(r.invalid).toContain("blank"); expect(r.orphanOverrides).toContain("orphan"); expect(r.placeholderMismatch).toContain("x {0}");
  });
});
