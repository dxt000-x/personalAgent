export type KnowledgeErrorCode =
  | "AUTH_REQUIRED" | "INVALID_REQUEST" | "UNSUPPORTED_FILE" | "FILE_TOO_LARGE"
  | "EMPTY_FILE" | "INVALID_FILE_CONTENT" | "PDF_PARSE_FAILED"
  | "DOCUMENT_NOT_FOUND" | "DOCUMENT_BUSY" | "STORAGE_UNAVAILABLE"
  | "KNOWLEDGE_UNAVAILABLE";

const details: Record<KnowledgeErrorCode, { status: number; message: string }> = {
  AUTH_REQUIRED: { status: 401, message: "请先登录。" },
  INVALID_REQUEST: { status: 400, message: "请求格式不符合要求。" },
  UNSUPPORTED_FILE: { status: 400, message: "仅支持 PDF、TXT 和 Markdown 文件。" },
  FILE_TOO_LARGE: { status: 413, message: "文件大小不能超过 4 MiB。" },
  EMPTY_FILE: { status: 400, message: "文件没有可读取的正文。" },
  INVALID_FILE_CONTENT: { status: 400, message: "文件实际内容与格式不符，或无法作为文本读取。" },
  PDF_PARSE_FAILED: { status: 400, message: "PDF 无法解析或没有可提取的文字。" },
  DOCUMENT_NOT_FOUND: { status: 404, message: "未找到该文档。" },
  DOCUMENT_BUSY: { status: 409, message: "文档正在处理；如长时间未完成，请稍后重试或删除。" },
  STORAGE_UNAVAILABLE: { status: 503, message: "文件存储暂时不可用，请稍后重试。" },
  KNOWLEDGE_UNAVAILABLE: { status: 503, message: "知识库服务暂时不可用，请稍后重试。" },
};

export class KnowledgeError extends Error {
  readonly status: number;
  constructor(readonly code: KnowledgeErrorCode) {
    super(details[code].message);
    this.name = "KnowledgeError";
    this.status = details[code].status;
  }
}

export function knowledgeErrorResponse(error: unknown): Response {
  const safe = error instanceof KnowledgeError ? error : new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  return Response.json({ error: { code: safe.code, message: safe.message } }, {
    status: safe.status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
