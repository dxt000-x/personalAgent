import { describe, expect, it } from "vitest";
import { validateToolInput } from "./tool-contract";
import { getRegisteredToolNames, lookupTool, validateRegisteredToolInput } from "./tool-registry";

describe("server Tool Registry allowlist", () => {
  it("looks up only code-registered Tool contracts", () => {
    expect(lookupTool("read_current_time")?.name).toBe("read_current_time");
    expect(lookupTool("read_app_status")?.name).toBe("read_app_status");
    expect(lookupTool("missing_tool")).toBeNull();
  });

  it("contains unique, fixed Tool names", () => {
    const names = getRegisteredToolNames();
    expect(names).toEqual(["read_current_time", "read_app_status"]);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.isFrozen(names)).toBe(true);
  });

  it("rejects malformed input, extra parameters and arbitrary commands", () => {
    const tool = lookupTool("read_current_time");
    expect(tool).not.toBeNull();
    if (!tool) return;
    expect(validateToolInput(tool, {})).toBe(true);
    expect(validateRegisteredToolInput(tool.name, {})).toBe(true);
    for (const input of [null, [], "", { command: "whoami" }, { path: "./file" }, { url: "https://example.com" }, { __proto__: null, shell: "x" }]) {
      expect(validateToolInput(tool, input)).toBe(false);
      expect(validateRegisteredToolInput(tool.name, input)).toBe(false);
    }
  });

  it("does not allow caller input to register or mutate Tools", () => {
    const names = getRegisteredToolNames();
    expect(Reflect.set(names, names.length, "user_tool")).toBe(false);
    const tool = lookupTool("read_app_status");
    expect(tool).not.toBeNull();
    expect(Reflect.set(tool as object, "name", "user_tool")).toBe(false);
    expect(lookupTool("user_tool")).toBeNull();
    expect(validateRegisteredToolInput("user_tool", {})).toBe(false);
  });

  it("never resolves module paths or function names", () => {
    for (const name of ["../ai/gateway", "./tool-registry", "process.exit", "constructor", "__proto__", "execute", "import('node:fs')", null]) {
      expect(lookupTool(name)).toBeNull();
    }
  });

  it("exposes metadata but no execution handler", () => {
    for (const name of getRegisteredToolNames()) {
      const tool = lookupTool(name);
      expect(tool).toMatchObject({
        name,
        readOnly: true,
        requiresConfirmation: false,
        inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
        execution: { status: "not_implemented" },
      });
      expect(tool?.description).toBeTruthy();
      expect(tool?.execution).not.toHaveProperty("handler");
      expect(validateToolInput(tool!, {})).toBe(true);
    }
  });
});
