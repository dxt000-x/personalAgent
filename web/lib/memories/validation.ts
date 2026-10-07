import { MemoryApiError } from "./errors";
import { memoryCategories, type CreateMemoryInput, type UpdateMemoryInput } from "./types";

const MAX_BODY_BYTES = 8 * 1024;
const allowedFields = new Set(["content", "category", "importance"]);

export async function readMemoryJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new MemoryApiError("INVALID_REQUEST");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_BODY_BYTES || !request.body) {
    throw new MemoryApiError("INVALID_REQUEST");
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new MemoryApiError("INVALID_REQUEST");
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof MemoryApiError) throw error;
    throw new MemoryApiError("INVALID_REQUEST");
  } finally {
    reader.releaseLock();
  }
}

export function validateCreateMemory(value: unknown): CreateMemoryInput {
  const input = asRecord(value);
  assertAllowedFields(input, true);
  return validateFields(input, true) as CreateMemoryInput;
}

export function validateUpdateMemory(value: unknown): UpdateMemoryInput {
  const input = asRecord(value);
  assertAllowedFields(input, false);
  if (Object.keys(input).length === 0) throw new MemoryApiError("INVALID_REQUEST");
  return validateFields(input, false) as UpdateMemoryInput;
}

export function validateMemoryId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new MemoryApiError("INVALID_REQUEST");
  }
  return id;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MemoryApiError("INVALID_REQUEST");
  }
  return value as Record<string, unknown>;
}

function assertAllowedFields(input: Record<string, unknown>, requireAll: boolean) {
  if (Object.keys(input).some((key) => !allowedFields.has(key))) {
    throw new MemoryApiError("INVALID_REQUEST");
  }
  if (requireAll && ["content", "category", "importance"].some((key) => !(key in input))) {
    throw new MemoryApiError("INVALID_REQUEST");
  }
}

function validateFields(input: Record<string, unknown>, requireAll: boolean): UpdateMemoryInput {
  const output: UpdateMemoryInput = {};

  if ("content" in input) {
    if (typeof input.content !== "string") throw new MemoryApiError("INVALID_REQUEST");
    const content = input.content.trim();
    if (!content || content.length > 2000) throw new MemoryApiError("INVALID_REQUEST");
    output.content = content;
  } else if (requireAll) {
    throw new MemoryApiError("INVALID_REQUEST");
  }

  if ("category" in input) {
    if (typeof input.category !== "string" || !memoryCategories.includes(input.category as (typeof memoryCategories)[number])) {
      throw new MemoryApiError("INVALID_REQUEST");
    }
    output.category = input.category as CreateMemoryInput["category"];
  } else if (requireAll) {
    throw new MemoryApiError("INVALID_REQUEST");
  }

  if ("importance" in input) {
    if (!Number.isInteger(input.importance) || Number(input.importance) < 1 || Number(input.importance) > 5) {
      throw new MemoryApiError("INVALID_REQUEST");
    }
    output.importance = Number(input.importance) as CreateMemoryInput["importance"];
  } else if (requireAll) {
    throw new MemoryApiError("INVALID_REQUEST");
  }

  return output;
}
