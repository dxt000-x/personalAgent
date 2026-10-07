export type AIErrorCode =
  | "AUTH_REQUIRED"
  | "PROVIDER_NOT_CONFIGURED"
  | "INVALID_REQUEST"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT";

const errorDetails: Record<AIErrorCode, { status: number; message: string }> = {
  AUTH_REQUIRED: { status: 401, message: "请先登录。" },
  PROVIDER_NOT_CONFIGURED: { status: 503, message: "所选模型服务尚未配置。" },
  INVALID_REQUEST: { status: 400, message: "请求格式或内容不符合要求。" },
  PROVIDER_ERROR: { status: 502, message: "模型服务暂时不可用。" },
  RATE_LIMITED: { status: 429, message: "模型服务请求过于频繁，请稍后重试。" },
  TIMEOUT: { status: 504, message: "模型服务响应超时，请稍后重试。" },
};

export class AIGatewayError extends Error {
  readonly status: number;

  constructor(readonly code: AIErrorCode, status?: number) {
    super(errorDetails[code].message);
    this.name = "AIGatewayError";
    this.status = status ?? errorDetails[code].status;
  }
}

export function providerFailure(error: unknown, signal: AbortSignal) {
  if (signal.aborted) return new AIGatewayError("TIMEOUT");
  if (typeof error === "object" && error !== null) {
    if ("status" in error && error.status === 429) {
      return new AIGatewayError("RATE_LIMITED");
    }
    if ("name" in error && error.name === "TimeoutError") {
      return new AIGatewayError("TIMEOUT");
    }
  }
  return new AIGatewayError("PROVIDER_ERROR");
}
