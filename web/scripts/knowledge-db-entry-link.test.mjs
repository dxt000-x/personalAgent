import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_NAME, PROJECT_REF } from "./knowledge-db-acceptance.mjs";

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(webDirectory, "scripts/verify-knowledge-db-concurrency.mjs");

describe("Knowledge DB entry ESM linkage", () => {
  it("reuses the fixed test project identity", () => {
    expect(PROJECT_NAME).toBe("personal-agent-quota-test");
    expect(PROJECT_REF).toBe("pxfaqcepztzqyqtmbdrf");
  });

  it.each([
    ["preflight", ["--preflight"]],
    ["execute", ["--execute"]],
    ["inspect-run", ["--inspect-run", "11111111-1111-4111-8111-111111111111"]],
  ])("links the real %s entry without reaching credentials or a database", (_mode, args) => {
    // The development checkout is intentionally rejected before environment validation.
    // A missing named export fails during ESM linkage, before this guard can run.
    const result = spawnSync(process.execPath, [entry, ...args], {
      cwd: webDirectory,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        TEMP: webDirectory,
        TMP: webDirectory,
      },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("WRONG_WORKTREE");
    expect(result.stderr).not.toContain("SyntaxError");
    expect(result.stderr).toContain("本轮未开始写入");
  });
});
