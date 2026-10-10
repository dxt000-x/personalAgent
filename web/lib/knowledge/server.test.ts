import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseKnowledgeRepository } from "./server";
import { assertKnowledgeWriterReady, callKnowledgeTransition } from "./private-db";
import { KnowledgeError } from "./errors";

vi.mock("./private-db", () => ({ assertKnowledgeWriterReady: vi.fn(), callKnowledgeTransition: vi.fn() }));

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "11111111-1111-4111-8111-111111111111";
const input = { fileName: "notes.txt", fileType: "txt" as const, byteSize: 10, contentType: "text/plain" };

beforeEach(() => { vi.resetAllMocks(); });

function repositoryWithInsertError(message: string) {
  const single = vi.fn(async () => ({ data: null, error: { code: "P0001", message } }));
  const from = vi.fn(() => ({ insert: vi.fn(() => ({ select: vi.fn(() => ({ single })) })) }));
  return new SupabaseKnowledgeRepository({ from } as never);
}

describe("Knowledge repository database boundaries", () => {
  it("returns a safe document/byte limit error from the database trigger", async () => {
    const repo = repositoryWithInsertError("KNOWLEDGE_LIMIT_REACHED");
    await expect(repo.create(userId, input)).rejects.toMatchObject({ code: "KNOWLEDGE_LIMIT_REACHED", status: 409 });
    expect(assertKnowledgeWriterReady).toHaveBeenCalledOnce();
  });
  it("returns a safe hourly upload error from the database trigger", async () => {
    const repo = repositoryWithInsertError("UPLOAD_RATE_LIMITED");
    await expect(repo.create(userId, input)).rejects.toMatchObject({ code: "UPLOAD_RATE_LIMITED", status: 429 });
  });
  it("does not submit parsed chunks through an authenticated Data API RPC", async () => {
    const rpc = vi.fn();
    const repo = new SupabaseKnowledgeRepository({ rpc } as never);
    vi.mocked(callKnowledgeTransition).mockResolvedValue(true);
    expect(await repo.complete(userId, documentId, 3, ["verified"])).toBe(true);
    expect(callKnowledgeTransition).toHaveBeenCalledWith("complete", [userId, documentId, 3, '["verified"]']);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not initialize an upload while the trusted writer is unavailable", async () => {
    const from = vi.fn();
    const repo = new SupabaseKnowledgeRepository({ from } as never);
    vi.mocked(assertKnowledgeWriterReady).mockRejectedValue(new KnowledgeError("KNOWLEDGE_UNAVAILABLE"));
    await expect(repo.create(userId, input)).rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE" });
    expect(from).not.toHaveBeenCalled();
  });
  it("passes the authenticated user ID to every private transition", async () => {
    const repo = new SupabaseKnowledgeRepository({ rpc: vi.fn() } as never);
    vi.mocked(callKnowledgeTransition).mockResolvedValue(true);
    await repo.claim(userId, documentId);
    await repo.fail(userId, documentId, 4, "temporary");
    await repo.complete(userId, documentId, 4, ["parsed"]);
    await repo.markDeleting(userId, documentId);
    await repo.finishDeleting(userId, documentId);
    expect(callKnowledgeTransition).toHaveBeenNthCalledWith(1, "claim", [userId, documentId]);
    expect(callKnowledgeTransition).toHaveBeenNthCalledWith(2, "fail", [userId, documentId, 4, "temporary"]);
    expect(callKnowledgeTransition).toHaveBeenNthCalledWith(3, "complete", [userId, documentId, 4, '["parsed"]']);
    expect(callKnowledgeTransition).toHaveBeenNthCalledWith(4, "markDeleting", [userId, documentId]);
    expect(callKnowledgeTransition).toHaveBeenNthCalledWith(5, "finishDeleting", [userId, documentId]);
  });
});
