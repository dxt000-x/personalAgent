import { AIGatewayError, providerFailure } from "@/lib/ai/errors";
import { aiErrorResponse, aiJson, requireUserId } from "@/lib/ai/http";
import { PROVIDER_TIMEOUT_MS } from "@/lib/ai/limits";
import { getProvider } from "@/lib/ai/provider-registry";
import { readJsonBody, validateChatRequest } from "@/lib/ai/request";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  try {
    const userId = await requireUserId();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      throw new AIGatewayError("INVALID_REQUEST");
    }

    const { provider: providerId, messages } = validateChatRequest(await readJsonBody(request));

    // Enforce a persistent per-user daily quota here in Task 3, using userId.
    void userId;
    const provider = getProvider(providerId);
    const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
    try {
      const result = await provider.generate(messages, signal);
      return aiJson(result);
    } catch (error) {
      throw error instanceof AIGatewayError ? error : providerFailure(error, signal);
    }
  } catch (error) {
    return aiErrorResponse(error);
  }
}
