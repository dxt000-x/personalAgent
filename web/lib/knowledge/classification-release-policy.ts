// Source-controlled closed release boundary. No env, request parameter or client flag can enable it.
export const KNOWLEDGE_CLASSIFICATION_PERSISTENCE_ENABLED: boolean = false;
export function classificationPersistenceUnavailable(): Response {
  return Response.json({ error: { code: "CLASSIFICATION_STORAGE_REQUIRED" } }, { status: 503,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
