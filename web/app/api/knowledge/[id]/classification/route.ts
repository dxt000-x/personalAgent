// Round78: sealed endpoint. No auth/database/body parsing occurs in this closed path.
import { classificationPersistenceUnavailable } from "@/lib/knowledge/classification-release-policy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(): Promise<Response> {
  return classificationPersistenceUnavailable();
}
