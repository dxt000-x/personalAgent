export const MAX_SEARCH_QUERY_CHARS = 100;
export const MAX_SEARCH_REQUEST_BYTES = 512;
export const MAX_SEARCH_RESULTS = 5;
export const MAX_SEARCH_SNIPPET_CHARS = 600;
export const MAX_SEARCH_TOTAL_CHARS = 4000;
export const SEARCH_TIMEOUT_MS = 3000;

export type KnowledgeSearchResult = {
  documentId: string;
  fileName: string;
  chunkIndex: number;
  snippet: string;
};
