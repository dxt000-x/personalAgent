import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { MAX_INPUT_CHARACTERS, MAX_MESSAGES } from "@/lib/ai/limits";
import type { ChatMessage, MemoryUsage } from "@/lib/ai/types";
import { formatMemoryContext, MAX_MEMORY_CONTEXT_CHARACTERS, MAX_MEMORY_CONTEXT_ITEMS } from "./context-format";
import { memoryCategories } from "./types";

type SupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

const memoryQueryTimeoutMs = 2_000;

export type RetrievedMemoryContext = {
  systemInstruction?: string;
  metadata: MemoryUsage;
};

/** Uses the authenticated user's SSR client so RLS remains the final ownership boundary. */
export async function retrievePersonalMemoryContext(
  supabase: SupabaseClient,
  userId: string,
  messages: ChatMessage[],
): Promise<RetrievedMemoryContext> {
  const conversationCharacters = messages.reduce((total, message) => total + message.content.length, 0);
  const availableCharacters = Math.min(
    MAX_MEMORY_CONTEXT_CHARACTERS,
    Math.max(0, MAX_INPUT_CHARACTERS - conversationCharacters),
  );

  // Providers that represent instructions as a message need one message slot for the system context.
  if (messages.length >= MAX_MESSAGES || availableCharacters === 0) {
    return { metadata: { status: "omitted", used: false, count: 0 } };
  }

  try {
    const { data, error } = await supabase
      .from("memories")
      .select("content,category,importance")
      .eq("user_id", userId)
      .order("importance", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(MAX_MEMORY_CONTEXT_ITEMS)
      .abortSignal(AbortSignal.timeout(memoryQueryTimeoutMs));

    if (error || !Array.isArray(data)) {
      return { metadata: { status: "unavailable", used: false, count: 0 } };
    }
    if (data.length === 0) {
      return { metadata: { status: "none", used: false, count: 0 } };
    }

    const records = data.flatMap((row) => {
      if (typeof row.content !== "string"
        || typeof row.category !== "string"
        || !memoryCategories.includes(row.category as (typeof memoryCategories)[number])
        || typeof row.importance !== "number"
        || !Number.isInteger(row.importance)
        || row.importance < 1 || row.importance > 5) {
        return [];
      }
      return [{
        content: row.content,
        category: row.category as (typeof memoryCategories)[number],
        importance: row.importance,
      }];
    });

    if (records.length === 0) {
      return { metadata: { status: "unavailable", used: false, count: 0 } };
    }

    const formatted = formatMemoryContext(records, availableCharacters);
    if (!formatted.systemInstruction) {
      return { metadata: { status: "omitted", used: false, count: 0 } };
    }

    return {
      systemInstruction: formatted.systemInstruction,
      metadata: { status: "used", used: true, count: formatted.count },
    };
  } catch {
    // Memory is optional context; avoid logging row contents or raw Supabase errors.
    return { metadata: { status: "unavailable", used: false, count: 0 } };
  }
}
