import { KnowledgeError, knowledgeErrorResponse } from "@/lib/knowledge/errors";
import { assertKnowledgeOrigin, privateKnowledgeJson, requireKnowledgeContext } from "@/lib/knowledge/server";
import { readSmallJson, validateUploadInput } from "@/lib/knowledge/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId, repository } = await requireKnowledgeContext();
    const rawOffset = new URL(request.url).searchParams.get("offset") ?? "0";
    if (!/^(0|[1-9][0-9]{0,5})$/u.test(rawOffset)) throw new KnowledgeError("INVALID_REQUEST");
    const offset = Number(rawOffset);
    return privateKnowledgeJson({ documents: await repository.list(userId, offset) });
  } catch (error) { return knowledgeErrorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId, repository } = await requireKnowledgeContext();
    assertKnowledgeOrigin(request);
    const input = validateUploadInput(await readSmallJson(request));
    const document = await repository.create(userId, input);
    return privateKnowledgeJson({ document, upload: {
      bucket: "knowledge-files", path: document.storage_path, contentType: input.contentType,
    } }, 201);
  } catch (error) {
    console.error("KNOWLEDGE_API_FAIL", {
      stage: "KNOWLEDGE_API_FAIL",
      error_class: error instanceof KnowledgeError ? error.code : "UNEXPECTED_ERROR",
    });
    return knowledgeErrorResponse(error);
  }
}
