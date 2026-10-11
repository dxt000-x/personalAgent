export type AIErrorCode =
  | "AUTH_REQUIRED"
  | "PROVIDER_NOT_CONFIGURED"
  | "PRIVACY_PROVIDER_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_REQUEST_REJECTED"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "CLOUD_QUOTA_EXCEEDED"
  | "QUOTA_UNAVAILABLE"
  | "TIMEOUT";

const errorDetails: Record<AIErrorCode, { status: number; message: string }> = {
  AUTH_REQUIRED: { status: 401, message: "请先登录。" },
  PROVIDER_NOT_CONFIGURED: { status: 503, message: "所选模型服务尚未配置。" },
  PRIVACY_PROVIDER_UNAVAILABLE: { status: 503, message: "当前没有可用的本地模型；隐私模式不会将消息发送到云端。" },
  INVALID_REQUEST: { status: 400, message: "请求格式或内容不符合要求。" },
  PROVIDER_AUTH_FAILED: { status: 502, message: "模型服务认证或权限校验失败，请检查服务配置。" },
  PROVIDER_REQUEST_REJECTED: { status: 502, message: "模型服务拒绝了本次请求，请检查模型配置后重试。" },
  PROVIDER_ERROR: { status: 502, message: "模型服务暂时不可用。" },
  RATE_LIMITED: { status: 429, message: "模型服务请求过于频繁，请稍后重试。" },
  CLOUD_QUOTA_EXCEEDED: { status: 429, message: "今日云端 AI 使用次数已达到上限，请于下一个 UTC 日期重置后再试。" },
  QUOTA_UNAVAILABLE: { status: 503, message: "云端 AI 使用额度暂时无法核验，请稍后重试。" },
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
  if (typeof error === "object" && error !== null) {
    if ("status" in error && typeof error.status === "number") {
      if (error.status === 429) return new AIGatewayError("RATE_LIMITED");
      if (error.status === 408) return new AIGatewayError("TIMEOUT");
      if (error.status === 401 || error.status === 403) return new AIGatewayError("PROVIDER_AUTH_FAILED");
      if (error.status >= 400 && error.status < 500) return new AIGatewayError("PROVIDER_REQUEST_REJECTED");
    }
    if ("name" in error && ["TimeoutError", "APIConnectionTimeoutError", "AbortError"].includes(String(error.name))) {
      return new AIGatewayError("TIMEOUT");
    }
  }
  if (signal.aborted) return new AIGatewayError("TIMEOUT");
  return new AIGatewayError("PROVIDER_ERROR");
}
