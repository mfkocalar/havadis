import { getWebDb } from "@/lib/db/openDb";
import { UNAVAILABLE, computeHealth } from "@/lib/health";
import type { HealthResult } from "@/lib/health";

/**
 * GET /api/health for the Docker healthcheck. Answers from one read of the database per request and
 * is never cached. If the database handle cannot even be opened the answer is the same fixed
 * unavailable body, so the endpoint never turns a broken database into an unhandled 500 with text.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  let result: HealthResult;
  try {
    result = await computeHealth(getWebDb(), Date.now());
  } catch {
    result = UNAVAILABLE;
  }
  return Response.json(result.body, { status: result.httpStatus, headers: { "Cache-Control": "no-store" } });
}
