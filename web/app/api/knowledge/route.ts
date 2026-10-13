import { KnowledgeError, knowledgeErrorResponse } from "@/lib/knowledge/errors";
import { assertKnowledgeOrigin, privateKnowledgeJson, requireKnowledgeContext } from "@/lib/knowledge/server";
import { readSmallJson, validateUploadInput } from "@/lib/knowledge/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Temporary Preview diagnostic: log only bounded project references, never URLs or credentials.
function publicProjectRef(): string {
  try {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
    return /^([a-z0-9]{20})\.supabase\.co$/u.exec(host)?.[1] ?? "UNKNOWN";
  } catch { return "UNKNOWN"; }
}

function writerProjectRef(): string {
  try {
    const username = decodeURIComponent(new URL(process.env.KNOWLEDGE_DB_URL ?? "").username);
    return /^knowledge_writer_login\.([a-z0-9]{20})$/u.exec(username)?.[1] ?? "UNKNOWN";
  } catch { return "UNKNOWN"; }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId, repository } = await requireKnowledgeContext();
    const rawOffset = new URL(request.url).searchParams.get("offset") ?? "0";
    if (!/^(0|[1-9][0-9]{0,5})$/u.test(rawOffset)) throw new KnowledgeError("INVALID_REQUEST");
    const offset = Number(rawOffset);
    console.info("KNOWLEDGE_PROJECT_REFS", {
      public_ref: publicProjectRef(), writer_ref: writerProjectRef(),
    });
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
