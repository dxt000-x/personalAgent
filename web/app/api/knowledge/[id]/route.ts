import { knowledgeErrorResponse } from "@/lib/knowledge/errors";
import { deleteKnowledgeDocument } from "@/lib/knowledge/service";
import { assertKnowledgeOrigin, requireKnowledgeContext } from "@/lib/knowledge/server";
import { validateDocumentId } from "@/lib/knowledge/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const { userId, repository } = await requireKnowledgeContext();
    assertKnowledgeOrigin(request);
    const id = validateDocumentId((await context.params).id);
    await deleteKnowledgeDocument(repository, userId, id);
    return new Response(null, { status: 204, headers: {
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return knowledgeErrorResponse(error); }
}
