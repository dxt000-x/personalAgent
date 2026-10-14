import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { requireMemoryContext } from "@/lib/memories/server";
import { MemoryApiError } from "@/lib/memories/errors";

vi.mock("@/lib/memories/server", () => ({
  memorySelect: "id,user_id,content,category,importance,source,created_at,updated_at",
  requireMemoryContext: vi.fn(),
  assertSameOrigin: vi.fn(),
  privateJson: (data: unknown, status = 200) => Response.json(data, { status }),
}));

const input = { content: "我长期使用 TypeScript", category: "preference", importance: 3 };
const countEq = vi.fn();
const duplicateEq = vi.fn();
const duplicateLimit = vi.fn();
const insert = vi.fn();
const single = vi.fn();
const selectInserted = vi.fn().mockReturnValue({ single });
const select = vi.fn();
const from = vi.fn().mockReturnValue({ select, insert });

function request(body: unknown = input): Request {
  return new Request("http://localhost:3000/api/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function signedInAs(userId: string) {
  vi.mocked(requireMemoryContext).mockResolvedValue({
    supabase: { from }, userId,
  } as unknown as Awaited<ReturnType<typeof requireMemoryContext>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  signedInAs("user-a");
  countEq.mockResolvedValue({ count: 199, error: null });
  duplicateEq.mockReturnValue({ limit: duplicateLimit });
  duplicateLimit.mockResolvedValue({ data: [], error: null });
  selectInserted.mockReturnValue({ single });
  single.mockResolvedValue({ data: { id: "memory-a", user_id: "user-a", ...input, source: "manual" }, error: null });
  insert.mockReturnValue({ select: selectInserted });
  select.mockImplementation((_fields: string, options?: { head?: boolean }) => ({ eq: options?.head ? countEq : duplicateEq }));
  from.mockReturnValue({ select, insert });
});

describe("POST /api/memories capacity", () => {
  it("creates a memory below the per-user limit", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).memory.source).toBe("manual");
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(countEq).toHaveBeenCalledWith("user_id", "user-a");
    expect(duplicateEq).toHaveBeenCalledWith("user_id", "user-a");
    expect(insert).toHaveBeenCalledWith({ user_id: "user-a", ...input });
  });

  it("rejects a new memory at the 200-item limit without inserting", async () => {
    countEq.mockResolvedValue({ count: 200, error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("MEMORY_LIMIT_REACHED");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects the current user's exact or normalized duplicate without inserting", async () => {
    duplicateLimit.mockResolvedValue({ data: [{ content: "我 长期使用 TypeScript。" }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("MEMORY_DUPLICATE");
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not turn a similar but distinct memory into a server rejection", async () => {
    duplicateLimit.mockResolvedValue({ data: [{ content: "我长期使用 TypeScript 开发项目" }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledOnce();
  });

  it("fails closed if duplicate lookup fails", async () => {
    duplicateLimit.mockResolvedValue({ data: null, error: { code: "XX000" } });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("MEMORY_SERVICE_ERROR");
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    { count: null, error: { code: "XX000" } },
    { count: null, error: null },
  ])("fails closed when the count is unavailable", async (result) => {
    countEq.mockResolvedValue(result);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("MEMORY_SERVICE_ERROR");
    expect(insert).not.toHaveBeenCalled();
  });

  it("requires authentication before counting or inserting", async () => {
    vi.mocked(requireMemoryContext).mockRejectedValue(new MemoryApiError("AUTH_REQUIRED"));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("counts and inserts only for the current session user", async () => {
    countEq.mockImplementation(async (_column: string, userId: string) => ({
      count: userId === "user-a" ? 200 : 199, error: null,
    }));
    const responseA = await POST(request());
    expect(responseA.status).toBe(409);
    expect(insert).not.toHaveBeenCalled();

    signedInAs("user-b");
    single.mockResolvedValue({ data: { id: "memory-b", user_id: "user-b", ...input, source: "manual" }, error: null });
    const responseB = await POST(request());
    expect(responseB.status).toBe(201);
    expect(countEq).toHaveBeenCalledWith("user_id", "user-a");
    expect(countEq).toHaveBeenCalledWith("user_id", "user-b");
    expect(duplicateEq).toHaveBeenCalledWith("user_id", "user-b");
    expect(insert).toHaveBeenCalledWith({ user_id: "user-b", ...input });
  });

  it("rejects client-supplied source and user_id", async () => {
    for (const extra of [{ source: "agent" }, { user_id: "user-b" }]) {
      const response = await POST(request({ ...input, ...extra }));
      expect(response.status).toBe(400);
    }
    expect(from).not.toHaveBeenCalled();
  });
});
