import { verifyAuthorization } from "@/lib/agent/execution-authorization";
import { executeRegisteredTool } from "@/lib/agent/tool-executor";
import { AIGatewayError } from "@/lib/ai/errors";
import { aiErrorResponse, aiJson, requireUserId } from "@/lib/ai/http";
import { readJsonBody } from "@/lib/ai/request";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const userId = await requireUserId();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new AIGatewayError("INVALID_REQUEST");
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, "authorization")) {
      throw new AIGatewayError("INVALID_REQUEST");
    }
    const tool = verifyAuthorization((body as { authorization: unknown }).authorization, userId, "confirmed");
    if (!tool) throw new AIGatewayError("INVALID_REQUEST");
    const result = await executeRegisteredTool(tool, {});
    return aiJson({ result });
  } catch (error) {
    return aiErrorResponse(error instanceof AIGatewayError ? error : new AIGatewayError("PROVIDER_ERROR"));
  }
}
