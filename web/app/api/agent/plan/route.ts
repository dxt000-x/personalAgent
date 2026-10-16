import { buildPlanningInstruction, MAX_PLAN_TASK_CHARS, parseAgentPlanText } from "@/lib/agent/planning";
import { AIGatewayError } from "@/lib/ai/errors";
import { runAiGateway } from "@/lib/ai/gateway";
import { aiErrorResponse, aiJson, requireAuthenticatedUser } from "@/lib/ai/http";
import { readJsonBody, validateChatRequest } from "@/lib/ai/request";
import { AIRequestDeadline } from "@/lib/ai/request-deadline";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const deadline = new AIRequestDeadline(request.signal);
  try {
    deadline.assertRemaining();
    return await deadline.wait((async () => {
      const { supabase } = await requireAuthenticatedUser();
      deadline.assertRemaining();

      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) throw new AIGatewayError("INVALID_REQUEST");
      const input = validateChatRequest(await readJsonBody(request, deadline.signal));
      if (input.knowledge || input.messages.length !== 1
        || input.messages[0].role !== "user"
        || input.messages[0].content.length > MAX_PLAN_TASK_CHARS) {
        throw new AIGatewayError("INVALID_REQUEST");
      }
      deadline.assertRemaining();

      const result = await runAiGateway(supabase, {
        provider: input.provider,
        routingPreference: input.routingPreference,
        messages: input.messages,
        systemInstruction: buildPlanningInstruction(),
      }, deadline);
      deadline.assertRemaining();
      const plan = parseAgentPlanText(result.text);
      if (!plan) throw new AIGatewayError("PROVIDER_ERROR");
      return aiJson({ plan });
    })());
  } catch (error) {
    const safeError = error instanceof AIGatewayError ? error
      : deadline.remainingMs() === 0 || deadline.signal.aborted
        ? new AIGatewayError("TIMEOUT") : new AIGatewayError("PROVIDER_ERROR");
    return aiErrorResponse(safeError);
  } finally {
    deadline.close();
  }
}
