export type MemoryApiErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "MEMORY_LIMIT_REACHED"
  | "MEMORY_DUPLICATE"
  | "MEMORY_ACCESS_DENIED"
  | "MEMORY_SERVICE_ERROR";

const errorDetails: Record<MemoryApiErrorCode, { status: number; message: string }> = {
  AUTH_REQUIRED: { status: 401, message: "请先登录。" },
  INVALID_REQUEST: { status: 400, message: "记忆内容或请求格式不符合要求。" },
  NOT_FOUND: { status: 404, message: "未找到这条个人记忆。" },
  MEMORY_LIMIT_REACHED: { status: 409, message: "个人记忆已达到 200 条上限，请先删除不再需要的记忆。" },
  MEMORY_DUPLICATE: { status: 409, message: "已有相同的个人记忆，请检查现有记忆。" },
  MEMORY_ACCESS_DENIED: { status: 403, message: "当前会话暂无个人记忆数据权限。" },
  MEMORY_SERVICE_ERROR: { status: 503, message: "个人记忆服务暂时不可用。" },
};

export class MemoryApiError extends Error {
  readonly status: number;

  constructor(readonly code: MemoryApiErrorCode) {
    super(errorDetails[code].message);
    this.name = "MemoryApiError";
    this.status = errorDetails[code].status;
  }
}

export function memoryErrorResponse(error: unknown): Response {
  const safeError = error instanceof MemoryApiError
    ? error
    : new MemoryApiError("MEMORY_SERVICE_ERROR");

  return Response.json(
    { error: { code: safeError.code, message: safeError.message } },
    {
      status: safeError.status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export function memoryDatabaseError(error: { code?: string } | null): MemoryApiError {
  return error?.code === "42501"
    ? new MemoryApiError("MEMORY_ACCESS_DENIED")
    : new MemoryApiError("MEMORY_SERVICE_ERROR");
}
