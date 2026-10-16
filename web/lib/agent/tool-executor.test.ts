import { describe, expect, it, vi } from "vitest";
import { executeRegisteredTool } from "./tool-executor";

describe("server Tool Executor", () => {
  it("runs the fixed current-time handler and returns structured UTC ISO time", async () => {
    const result = await executeRegisteredTool("read_current_time", {});
    expect(result).toMatchObject({ tool: "read_current_time", ok: true, data: { iso: expect.any(String) } });
    const iso = (result.data as { iso: string }).iso;
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it.each([
    null, "", [], { time: "2000-01-01T00:00:00.000Z" },
    { handler: "fake" }, { module: "node:fs" }, { command: "whoami" }, { url: "https://example.com" },
  ])("rejects invalid or nonempty input: %#", async (input) => {
    await expect(executeRegisteredTool("read_current_time", input)).rejects.toMatchObject({ code: "INVALID_TOOL_INPUT" });
  });

  it("rejects names outside the static Registry", async () => {
    for (const name of ["unknown", "../module", "process.exit", "execute", null]) {
      await expect(executeRegisteredTool(name, {})).rejects.toMatchObject({ code: "TOOL_NOT_FOUND" });
    }
  });

  it("rejects a registered Tool that has no handler", async () => {
    await expect(executeRegisteredTool("read_app_status", {})).rejects.toMatchObject({ code: "TOOL_NOT_IMPLEMENTED" });
  });

  it("does not invoke a function supplied through input", async () => {
    const injected = vi.fn();
    await expect(executeRegisteredTool("read_current_time", { handler: injected })).rejects.toMatchObject({ code: "INVALID_TOOL_INPUT" });
    expect(injected).not.toHaveBeenCalled();
  });
});
