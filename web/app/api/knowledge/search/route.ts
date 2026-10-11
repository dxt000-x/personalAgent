import { knowledgeErrorResponse } from "@/lib/knowledge/errors";
import { searchKnowledgeChunks, validateSearchInput } from "@/lib/knowledge/search";
import { MAX_SEARCH_REQUEST_BYTES } from "@/lib/knowledge/search-types";
import { assertKnowledgeOrigin, privateKnowledgeJson, requireKnowledgeSearchContext } from "@/lib/knowledge/server";
import { readSmallJson } from "@/lib/knowledge/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId, client } = await requireKnowledgeSearchContext();
    assertKnowledgeOrigin(request);
    const { query, documentId } = validateSearchInput(await readSmallJson(request, MAX_SEARCH_REQUEST_BYTES));
    return privateKnowledgeJson({ results: await searchKnowledgeChunks(client, userId, query, documentId) });
  } catch (error) { return knowledgeErrorResponse(error); }
}
