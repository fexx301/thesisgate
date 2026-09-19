import { MarketRequestSchema } from "@/domain/contracts";
import { getMarket, MarketAdapterError } from "@/server/bitget";
import { assertAllowedOrigin, checkRouteRateLimit, jsonError, parseJsonRequest, requestContext, RequestOriginError, RequestValidationError } from "@/server/http";
import { assertRecomputeSigningConfigured, createRecomputeToken, RecomputeReceiptError } from "@/server/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertAllowedOrigin(request);
    checkRouteRateLimit(requestContext(request).visitorKey, "market");
    const input = await parseJsonRequest(request, MarketRequestSchema, 8_000);
    assertRecomputeSigningConfigured();
    const market = await getMarket(input.asset, input.mode);
    return Response.json({ ...market, recomputeToken: createRecomputeToken(market.instrument, market.snapshot) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestOriginError) return jsonError(error.message, 403);
    if (error instanceof RequestValidationError) return jsonError(error.message, error.status);
    if (error instanceof RecomputeReceiptError) return jsonError("Server economics reuse is not configured.", 503);
    if (error instanceof MarketAdapterError) return jsonError(error.message, 502);
    return jsonError("Market data could not be loaded.", 502);
  }
}
