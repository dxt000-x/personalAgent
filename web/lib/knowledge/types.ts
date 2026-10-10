export const KNOWLEDGE_BUCKET = "knowledge-files";
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;
export const MAX_PDF_PAGES = 50;
export const MAX_CHUNKS = 200;
export const CHUNK_CHARS = 1100;
export const DOCUMENT_PAGE_SIZE = 100;
export const MAX_DOCUMENTS_PER_USER = 100;
export const MAX_USER_STORAGE_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOADS_PER_UTC_HOUR = 20;

export type KnowledgeFileType = "pdf" | "txt" | "md";
export type KnowledgeStatus = "uploading" | "processing" | "ready" | "failed" | "deleting";
export type KnowledgeFailureKind = "invalid_file" | "temporary" | null;

export type KnowledgeDocument = {
  id: string;
  user_id: string;
  file_name: string;
  file_type: KnowledgeFileType;
  byte_size: number;
  storage_path: string;
  status: KnowledgeStatus;
  failure_kind: KnowledgeFailureKind;
  processing_generation: number;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export type UploadInput = {
  fileName: string;
  fileType: KnowledgeFileType;
  byteSize: number;
  contentType: string;
};
