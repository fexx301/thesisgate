import { FORMULA_VERSION, RecomputeRequestSchema, RecomputeResultSchema } from "@/domain/contracts";
import { calculateEconomics } from "@/domain/economics";
import { economicsInputHash } from "@/domain/revisions";
import { assertAllowedOrigin, checkRouteRateLimit, jsonError, parseJsonRequest, requestContext, RequestOriginError, RequestValidationError } from "@/server/http";
import { newId } from "@/server/identifiers";
import { RecomputeReceiptError, verifyRecomputeToken } from "@/server/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    assertAllowedOrigin(request);
    checkRouteRateLimit(requestContext(request).visitorKey, "recompute");
    const input = await parseJsonRequest(request, RecomputeRequestSchema, 100_000);
    if (!verifyRecomputeToken(input.recomputeToken, input.instrument, input.snapshot)) {
      return jsonError("The market snapshot was not issued by this server. Run a fresh research request.", 409);
    }
    const economics = calculateEconomics({
      plan: input.plan,
      instrument: input.instrument,
      snapshot: input.snapshot,
      planRevision: input.planRevision,
      scenarioRevision: input.scenarioRevision,
    });
    const result = RecomputeResultSchema.parse({
      reportId: newId("report"),
      reportRevision: input.planRevision,
      economicsInputHash: await economicsInputHash(input.plan, input.instrument, input.snapshot, FORMULA_VERSION),
      economics,
      performance: {
        totalDurationMs: Math.max(0, Date.now() - startedAt),
        marketDurationMs: null,
        modelDurationMs: null,
        modelCalls: 0,
        modelRunStatus: "evidence_reused",
        modelUsage: null,
        reusedEvidence: true,
      },
      generatedAt: new Date().toISOString(),
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestOriginError) return jsonError(error.message, 403);
    if (error instanceof RequestValidationError) return jsonError(error.message, error.status);
    if (error instanceof RecomputeReceiptError) return jsonError("Server economics reuse is not configured.", 503);
    return jsonError("The economics could not be recomputed.", 400);
  }
}
