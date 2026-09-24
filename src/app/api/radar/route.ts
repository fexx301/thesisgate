import { RadarRequestSchema, RadarResultSchema } from "@/domain/contracts";
import { buildMarketContext } from "@/domain/priced-in";
import { getMarket } from "@/server/bitget";
import { fetchHeadlines } from "@/server/feeds";
import { assertAllowedOrigin, checkRouteRateLimit, jsonError, parseJsonRequest, requestContext, RequestOriginError, RequestValidationError } from "@/server/http";
import { getUnderlyingQuote } from "@/server/underlying";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The after-hours radar: fresh headlines plus where the 24/7 rToken trades against the last US close. */
export async function POST(request: Request) {
  try {
    assertAllowedOrigin(request);
    checkRouteRateLimit(requestContext(request).visitorKey, "radar");
    const input = await parseJsonRequest(request, RadarRequestSchema, 4_000);
    const now = new Date();
    const [feeds, market, underlying] = await Promise.all([
      fetchHeadlines(input.asset, input.mode),
      getMarket(input.asset, input.mode).catch((error: unknown) => ({ error })),
      getUnderlyingQuote(input.asset, input.mode, now).catch((error: unknown) => ({ error })),
    ]);
    const snapshot = "snapshot" in market ? market.snapshot : null;
    const quote = "error" in underlying ? null : underlying;
    const warnings: string[] = [];
    if ("error" in market) warnings.push(`rToken order book unavailable: ${market.error instanceof Error ? market.error.message : "request failed"}`);
    if ("error" in underlying) warnings.push(`Underlying quote unavailable: ${underlying.error instanceof Error ? underlying.error.message : "request failed"}`);
    const marketContext = buildMarketContext({
      asset: input.asset,
      mode: input.mode,
      observedAt: input.mode === "captured_real" && snapshot ? snapshot.receivedAt : now.toISOString(),
      underlying: quote,
      snapshot,
      warnings,
    });
    const result = RadarResultSchema.parse({
      asset: input.asset,
      mode: input.mode,
      headlines: feeds.headlines,
      marketContext,
      feedWarnings: feeds.warnings,
      generatedAt: now.toISOString(),
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestOriginError) return jsonError(error.message, 403);
    if (error instanceof RequestValidationError) return jsonError(error.message, error.status);
    return jsonError("The radar could not be loaded.", 502);
  }
}
