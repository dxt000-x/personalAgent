import { aiErrorResponse, aiJson, requireUserId } from "@/lib/ai/http";
import { getProviderStatuses } from "@/lib/ai/provider-registry";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    await requireUserId();
    return aiJson(getProviderStatuses());
  } catch (error) {
    return aiErrorResponse(error);
  }
}
