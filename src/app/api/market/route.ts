import { MarketRequestSchema } from "@/domain/contracts";
import { buildMarketContext } from "@/domain/priced-in";
import { getMarket, MarketAdapterError } from "@/server/bitget";
import { getUnderlyingQuote } from "@/server/underlying";
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
    const now = new Date();
    const [market, underlying] = await Promise.all([
      getMarket(input.asset, input.mode),
      getUnderlyingQuote(input.asset, input.mode, now).then((quote) => ({ quote, warning: null }), (error: unknown) => ({ quote: null, warning: `Underlying quote unavailable: ${error instanceof Error ? error.message : "request failed"}` })),
    ]);
    const marketContext = buildMarketContext({
      asset: input.asset,
      mode: input.mode,
      observedAt: input.mode === "captured_real" ? market.snapshot.receivedAt : now.toISOString(),
      underlying: underlying.quote,
      snapshot: market.snapshot,
      warnings: underlying.warning ? [underlying.warning] : [],
    });
    return Response.json({ ...market, marketContext, recomputeToken: createRecomputeToken(market.instrument, market.snapshot) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestOriginError) return jsonError(error.message, 403);
    if (error instanceof RequestValidationError) return jsonError(error.message, error.status);
    if (error instanceof RecomputeReceiptError) return jsonError("Server economics reuse is not configured.", 503);
    if (error instanceof MarketAdapterError) return jsonError(error.message, 502);
    return jsonError("Market data could not be loaded.", 502);
  }
}
