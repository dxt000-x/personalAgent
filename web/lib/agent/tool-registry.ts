import "server-only";
import { validateToolInput } from "./tool-contract";
import type { ToolContract } from "./tool-contract";

const noInput = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  required: Object.freeze([]),
  additionalProperties: false,
} as const);

// These contracts advertise future capabilities; neither has an execution handler.
const definitions = Object.freeze([
  Object.freeze({
    name: "read_current_time",
    description: "读取当前时间（尚未实现）",
    inputSchema: noInput,
    readOnly: true,
    requiresConfirmation: false,
    execution: Object.freeze({ status: "not_implemented" }),
  }),
  Object.freeze({
    name: "read_app_status",
    description: "读取应用状态（尚未实现）",
    inputSchema: noInput,
    readOnly: true,
    requiresConfirmation: false,
    execution: Object.freeze({ status: "not_implemented" }),
  }),
] as const satisfies readonly ToolContract[]);

const registry = new Map<string, ToolContract>();
for (const tool of definitions) {
  if (!/^[a-z][a-z0-9_]*$/u.test(tool.name) || registry.has(tool.name)
    || tool.execution.status !== "not_implemented") {
    throw new Error("Invalid or duplicate registered Tool name");
  }
  registry.set(tool.name, tool);
}

export function getRegisteredToolNames(): readonly string[] {
  return Object.freeze([...registry.keys()]);
}

export function lookupTool(name: unknown): ToolContract | null {
  return typeof name === "string" && registry.has(name) ? registry.get(name) ?? null : null;
}

export function validateRegisteredToolInput(name: unknown, input: unknown): boolean {
  const tool = lookupTool(name);
  return tool !== null && validateToolInput(tool, input);
}
