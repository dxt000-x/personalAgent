import { verifyExecutionAuthorization } from "@/lib/agent/execution-authorization";
import { executeRegisteredTool } from "@/lib/agent/tool-executor";
import { consumeExecutionAuthorization, finishExecutionAuthorization } from "@/lib/agent/execution-store";
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
    const authorization = verifyExecutionAuthorization((body as { authorization: unknown }).authorization, userId);
    if (!authorization) throw new AIGatewayError("INVALID_REQUEST");
    const consumed = await consumeExecutionAuthorization(userId, authorization);
    if (consumed === "replay") throw new AIGatewayError("REPLAY_REJECTED");
    if (consumed !== "acquired") throw new AIGatewayError("INVALID_REQUEST");
    let result;
    try {
      result = await executeRegisteredTool(authorization.tool, {});
    } catch {
      await finishExecutionAuthorization(userId, authorization.jti, false, "TOOL_FAILED");
      throw new AIGatewayError("EXECUTION_UNAVAILABLE");
    }
    await finishExecutionAuthorization(userId, authorization.jti, true, null);
    return aiJson({ result });
  } catch (error) {
    return aiErrorResponse(error instanceof AIGatewayError ? error : new AIGatewayError("EXECUTION_UNAVAILABLE"));
  }
}
