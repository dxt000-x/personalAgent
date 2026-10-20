import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { diagnoseExecutionDatabase } from "@/lib/agent/execution-store";
import { requireUserId } from "@/lib/ai/http";

vi.mock("@/lib/agent/execution-store", () => ({ diagnoseExecutionDatabase: vi.fn() }));
vi.mock("@/lib/ai/http", () => ({ requireUserId: vi.fn() }));

const sha = "a".repeat(40);
const userId = "11111111-1111-4111-8111-111111111111";
const result = { publicRefExpected: "pass", writerRefExpected: "pass",
  poolerConfig: "pass", caConfig: "pass", connection: "pass",
  tlsVerification: "pass", databaseName: "pass",
  projectIdentity: "inferred_from_pooler_routing" };

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "feat/agent-planning-mvp");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sha);
  vi.stubEnv("AGENT_DIAGNOSTIC_EXPECTED_SHA", sha);
  vi.stubEnv("AGENT_DIAGNOSTIC_USER_ID", userId);
  vi.mocked(requireUserId).mockResolvedValue(userId);
  vi.mocked(diagnoseExecutionDatabase).mockResolvedValue(result as Awaited<ReturnType<typeof diagnoseExecutionDatabase>>);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("temporary execution database diagnostic access gate", () => {
  it("returns fixed states to the approved authenticated Preview user without caching", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.json()).toEqual(result);
    expect(diagnoseExecutionDatabase).toHaveBeenCalledTimes(1);
  });

  it.each(["unauthenticated", "wrong_user", "missing_user", "invalid_user",
    "non_preview", "wrong_branch", "missing_branch", "wrong_sha", "missing_sha",
    "missing_expected_sha", "invalid_expected_sha"])("rejects %s before database access", async (caseName) => {
    if (caseName === "unauthenticated") vi.mocked(requireUserId).mockRejectedValue(new Error("private auth detail"));
    if (caseName === "wrong_user") vi.mocked(requireUserId).mockResolvedValue("22222222-2222-4222-8222-222222222222");
    if (caseName === "missing_user") vi.stubEnv("AGENT_DIAGNOSTIC_USER_ID", "");
    if (caseName === "invalid_user") vi.stubEnv("AGENT_DIAGNOSTIC_USER_ID", "operator");
    if (caseName === "non_preview") vi.stubEnv("VERCEL_ENV", "production");
    if (caseName === "wrong_branch") vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
    if (caseName === "missing_branch") vi.stubEnv("VERCEL_GIT_COMMIT_REF", "");
    if (caseName === "wrong_sha") vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "b".repeat(40));
    if (caseName === "missing_sha") vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    if (caseName === "missing_expected_sha") vi.stubEnv("AGENT_DIAGNOSTIC_EXPECTED_SHA", "");
    if (caseName === "invalid_expected_sha") vi.stubEnv("AGENT_DIAGNOSTIC_EXPECTED_SHA", "short");
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
    expect(diagnoseExecutionDatabase).not.toHaveBeenCalled();
  });

  it("never exposes a raw database failure or secret", async () => {
    vi.mocked(diagnoseExecutionDatabase).mockRejectedValue(new Error("private URL password token"));
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
  });
});
