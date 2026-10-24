/** Metadata for a code-defined Tool. Client input can never provide this contract. */
export type ToolParameterSchema =
  | Readonly<{ type: "string"; maxLength: number }>
  | Readonly<{ type: "integer"; minimum: number; maximum: number }>
  | Readonly<{ type: "boolean" }>;

export type ToolInputSchema = Readonly<{
  type: "object";
  properties: Readonly<Record<string, ToolParameterSchema>>;
  required: readonly string[];
  additionalProperties: false;
}>;

export type ToolExecutionContext = Readonly<{ signal: AbortSignal }>;
export type ToolExecutor<TInput, TResult> = (
  input: Readonly<TInput>,
  context: ToolExecutionContext,
) => Promise<TResult>;

export type ToolExecution<TInput, TResult> =
  | Readonly<{ status: "not_implemented"; handler?: never }>
  | Readonly<{ status: "implemented"; handler: ToolExecutor<TInput, TResult> }>;

export type ToolContract<TName extends string = string, TInput = Record<string, unknown>, TResult = unknown> = Readonly<{
  name: TName;
  description: string;
  inputSchema: ToolInputSchema;
  readOnly: boolean;
  requiresConfirmation: boolean;
  execution: ToolExecution<TInput, TResult>;
}>;

/** Only schema fields declared by server code are accepted. Current Tools declare none. */
export function validateToolInput(tool: ToolContract, input: unknown): input is Record<string, unknown> {
  if (tool.inputSchema.type !== "object" || tool.inputSchema.additionalProperties !== false
    || typeof input !== "object" || input === null || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return false;

  const values = input as Record<string, unknown>;
  const { properties, required } = tool.inputSchema;
  if (required.some((key) => !Object.hasOwn(values, key))) return false;
  for (const [key, value] of Object.entries(values)) {
    if (!Object.hasOwn(properties, key)) return false;
    const field = properties[key];
    if (field.type === "string" && (typeof value !== "string" || value.length > field.maxLength)) return false;
    if (field.type === "integer" && (typeof value !== "number" || !Number.isInteger(value)
      || value < field.minimum || value > field.maximum)) return false;
    if (field.type === "boolean" && typeof value !== "boolean") return false;
  }
  return true;
}
