import { ResearchRequestSchema, RESEARCH_REQUEST_MAX_BYTES } from "@/domain/contracts";
import { runResearch } from "@/server/research";
import { assertAllowedOrigin, jsonError, parseJsonRequest, requestContext, RequestOriginError, RequestValidationError } from "@/server/http";
import { RecomputeReceiptError } from "@/server/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertAllowedOrigin(request);
    const input = await parseJsonRequest(request, ResearchRequestSchema, RESEARCH_REQUEST_MAX_BYTES);
    const report = await runResearch(input, requestContext(request));
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestOriginError) return jsonError(error.message, 403);
    if (error instanceof RequestValidationError) return jsonError(error.message, 400);
    if (error instanceof RecomputeReceiptError) return jsonError("Server economics reuse is not configured.", 503);
    return jsonError("The research request could not be completed.", 500);
  }
}
