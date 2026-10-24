import "server-only";
import { validateToolInput } from "./tool-contract";
import { lookupTool } from "./tool-registry";

export type ToolResult = Readonly<{ tool: string; ok: true; data: unknown }>;
export type ToolExecutionErrorCode = "TOOL_NOT_FOUND" | "INVALID_TOOL_INPUT" | "TOOL_NOT_IMPLEMENTED" | "TOOL_FAILED";

const errorMessages: Record<ToolExecutionErrorCode, string> = {
  TOOL_NOT_FOUND: "Tool is not registered.",
  INVALID_TOOL_INPUT: "Tool input is invalid.",
  TOOL_NOT_IMPLEMENTED: "Tool is not implemented.",
  TOOL_FAILED: "Tool execution failed.",
};

export class ToolExecutionError extends Error {
  constructor(readonly code: ToolExecutionErrorCode) {
    super(errorMessages[code]);
    this.name = "ToolExecutionError";
  }
}

/** No route calls this yet. The only executable handler is fixed in the server Registry. */
export async function executeRegisteredTool(name: unknown, input: unknown): Promise<ToolResult> {
  const tool = lookupTool(name);
  if (!tool) throw new ToolExecutionError("TOOL_NOT_FOUND");
  if (!validateToolInput(tool, input)) throw new ToolExecutionError("INVALID_TOOL_INPUT");
  if (tool.execution.status !== "implemented") throw new ToolExecutionError("TOOL_NOT_IMPLEMENTED");

  try {
    const data = await tool.execution.handler(input, { signal: new AbortController().signal });
    return { tool: tool.name, ok: true, data };
  } catch {
    throw new ToolExecutionError("TOOL_FAILED");
  }
}
