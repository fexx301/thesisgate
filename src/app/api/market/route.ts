import { MarketRequestSchema } from "@/domain/contracts";
import { getMarket, MarketAdapterError } from "@/server/bitget";
import { assertAllowedOrigin, jsonError, parseJsonRequest, RequestOriginError, RequestValidationError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertAllowedOrigin(request);
    const input = await parseJsonRequest(request, MarketRequestSchema, 8_000);
    const market = await getMarket(input.asset, input.mode);
    return Response.json(market, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestOriginError) return jsonError(error.message, 403);
    if (error instanceof RequestValidationError) return jsonError(error.message, 400);
    if (error instanceof MarketAdapterError) return jsonError(error.message, 502);
    return jsonError("Market data could not be loaded.", 502);
  }
}
