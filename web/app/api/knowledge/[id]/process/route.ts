import { knowledgeErrorResponse } from "@/lib/knowledge/errors";
import { processKnowledgeDocument } from "@/lib/knowledge/service";
import { assertKnowledgeOrigin, privateKnowledgeJson, requireKnowledgeContext } from "@/lib/knowledge/server";
import { validateDocumentId } from "@/lib/knowledge/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { userId, repository } = await requireKnowledgeContext();
    assertKnowledgeOrigin(request);
    const id = validateDocumentId((await context.params).id);
    return privateKnowledgeJson({ document: await processKnowledgeDocument(repository, userId, id) });
  } catch (error) { return knowledgeErrorResponse(error); }
}
