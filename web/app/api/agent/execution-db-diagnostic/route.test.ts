import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { diagnoseExecutionDatabase } from "@/lib/agent/execution-store";
import { requireUserId } from "@/lib/ai/http";

vi.mock("@/lib/agent/execution-store", () => ({ diagnoseExecutionDatabase: vi.fn() }));
vi.mock("@/lib/ai/http", () => ({ requireUserId: vi.fn() }));

const sha = "a".repeat(40);
const result = { publicRefExpected: "pass", writerRefMatchesPublic: "pass",
  poolerConfig: "pass", caConfig: "pass", connection: "pass",
  tlsVerification: "pass", databaseName: "pass",
  projectIdentity: "inferred_from_pooler_routing" };

beforeEach(() => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_SHA = sha;
  process.env.AGENT_DIAGNOSTIC_EXPECTED_SHA = sha;
  process.env.AGENT_DIAGNOSTIC_USER_ID = "operator-id";
  vi.mocked(requireUserId).mockResolvedValue("operator-id");
  vi.mocked(diagnoseExecutionDatabase).mockResolvedValue(result as Awaited<ReturnType<typeof diagnoseExecutionDatabase>>);
});

afterEach(() => {
  for (const key of ["VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA", "AGENT_DIAGNOSTIC_EXPECTED_SHA", "AGENT_DIAGNOSTIC_USER_ID"]) delete process.env[key];
  vi.resetAllMocks();
});

describe("temporary execution database diagnostic", () => {
  it("returns only fixed statuses to the selected Preview operator", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(result);
    expect(diagnoseExecutionDatabase).toHaveBeenCalledTimes(1);
  });

  it.each(["unauthenticated", "wrong_user", "non_preview", "wrong_sha", "missing_sha", "missing_expected_sha", "source_sha", "missing_allowlist"])(
    "rejects %s without probing", async (caseName) => {
      if (caseName === "unauthenticated") vi.mocked(requireUserId).mockRejectedValue(new Error("private auth detail"));
      if (caseName === "wrong_user") vi.mocked(requireUserId).mockResolvedValue("someone-else");
      if (caseName === "non_preview") process.env.VERCEL_ENV = "production";
      if (caseName === "wrong_sha") process.env.VERCEL_GIT_COMMIT_SHA = "b".repeat(40);
      if (caseName === "missing_sha") delete process.env.VERCEL_GIT_COMMIT_SHA;
      if (caseName === "missing_expected_sha") delete process.env.AGENT_DIAGNOSTIC_EXPECTED_SHA;
      if (caseName === "source_sha") {
        process.env.VERCEL_GIT_COMMIT_SHA = "9f683c554874e00972299213b1cdcbb07aaa3601";
        process.env.AGENT_DIAGNOSTIC_EXPECTED_SHA = process.env.VERCEL_GIT_COMMIT_SHA;
      }
      if (caseName === "missing_allowlist") delete process.env.AGENT_DIAGNOSTIC_USER_ID;
      const response = await GET();
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.text()).toBe("");
      expect(diagnoseExecutionDatabase).not.toHaveBeenCalled();
    },
  );

  it("hides probe failures and raw exceptions", async () => {
    vi.mocked(diagnoseExecutionDatabase).mockRejectedValue(new Error("raw database secret detail"));
    const response = await GET();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});
