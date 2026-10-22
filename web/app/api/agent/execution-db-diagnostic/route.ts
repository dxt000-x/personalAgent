import { diagnoseExecutionDatabase } from "@/lib/agent/execution-store";
import { requireUserId } from "@/lib/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const targetBranch = "feat/agent-planning-mvp";
const shaPattern = /^[0-9a-f]{40}$/u;
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type Check = boolean | "not_checked";
type DiagnosticLog = {
  event: "agent_execution_db_diagnostic";
  stage: "authentication" | "access_gate" | "database" | "complete";
  authSucceeded: boolean;
  allowedUserConfigValid: Check;
  userMatchesAllowed: Check;
  previewEnv: Check;
  branchMatches: Check;
  expectedShaValid: Check;
  deploymentShaValid: Check;
  shaMatches: Check;
  databaseDiagnosticException: Check;
  errorClass: "none" | "authentication_failed" | "access_denied" | "database_diagnostic_failed";
};

function logDiagnostic(record: DiagnosticLog): void {
  console.info(JSON.stringify(record));
}

export async function GET(): Promise<Response> {
  const record: DiagnosticLog = {
    event: "agent_execution_db_diagnostic", stage: "authentication", authSucceeded: false,
    allowedUserConfigValid: "not_checked", userMatchesAllowed: "not_checked",
    previewEnv: "not_checked", branchMatches: "not_checked",
    expectedShaValid: "not_checked", deploymentShaValid: "not_checked",
    shaMatches: "not_checked", databaseDiagnosticException: "not_checked",
    errorClass: "none",
  };
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    record.errorClass = "authentication_failed";
    logDiagnostic(record);
    return new Response(null, { status: 404, headers });
  }
  record.authSucceeded = true;
  record.stage = "access_gate";
  const allowedUserId = process.env.AGENT_DIAGNOSTIC_USER_ID;
  const expectedSha = process.env.AGENT_DIAGNOSTIC_EXPECTED_SHA;
  const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA;
  record.allowedUserConfigValid = typeof allowedUserId === "string" && userIdPattern.test(allowedUserId);
  record.userMatchesAllowed = record.allowedUserConfigValid && userId === allowedUserId;
  record.previewEnv = process.env.VERCEL_ENV === "preview";
  record.branchMatches = process.env.VERCEL_GIT_COMMIT_REF === targetBranch;
  record.expectedShaValid = typeof expectedSha === "string" && shaPattern.test(expectedSha);
  record.deploymentShaValid = typeof deploymentSha === "string" && shaPattern.test(deploymentSha);
  record.shaMatches = record.expectedShaValid && record.deploymentShaValid && deploymentSha === expectedSha;
  if (!record.userMatchesAllowed || !record.previewEnv || !record.branchMatches || !record.shaMatches) {
    record.errorClass = "access_denied";
    logDiagnostic(record);
    return new Response(null, { status: 404, headers });
  }
  record.stage = "database";
  try {
    const result = await diagnoseExecutionDatabase();
    const response = Response.json(result, { headers });
    record.databaseDiagnosticException = false;
    record.stage = "complete";
    logDiagnostic(record);
    return response;
  } catch {
    record.databaseDiagnosticException = true;
    record.errorClass = "database_diagnostic_failed";
    logDiagnostic(record);
    return new Response(null, { status: 404, headers });
  }
}
