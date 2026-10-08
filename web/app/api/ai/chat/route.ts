import { AIGatewayError } from "@/lib/ai/errors";
import { runAiGateway } from "@/lib/ai/gateway";
import { aiErrorResponse, aiJson, requireAuthenticatedUser } from "@/lib/ai/http";
import { readJsonBody, validateChatRequest } from "@/lib/ai/request";
import type { AIChatResult } from "@/lib/ai/types";
import { retrievePersonalMemoryContext } from "@/lib/memories/context";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  try {
    const { supabase, userId } = await requireAuthenticatedUser();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      throw new AIGatewayError("INVALID_REQUEST");
    }

    const { provider: providerId, routingPreference, messages } = validateChatRequest(await readJsonBody(request));
    const memoryContext = await retrievePersonalMemoryContext(supabase, userId, messages);
    const result = await runAiGateway(supabase, {
      provider: providerId, routingPreference, messages, systemInstruction: memoryContext.systemInstruction,
    });
    return aiJson({ ...result, memory: memoryContext.metadata } satisfies AIChatResult);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
