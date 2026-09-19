import { TelemetryEventSchema } from "@/domain/telemetry";
import { assertAllowedOrigin, checkRouteRateLimit, jsonError, parseJsonRequest, requestContext, RequestOriginError, RequestValidationError } from "@/server/http";
import { recordTelemetry } from "@/server/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertAllowedOrigin(request);
    checkRouteRateLimit(requestContext(request).visitorKey, "telemetry");
    const event = await parseJsonRequest(request, TelemetryEventSchema, 4_000);
    await recordTelemetry(event);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestOriginError) return jsonError(error.message, 403);
    if (error instanceof RequestValidationError) return jsonError(error.message, error.status);
    return jsonError("Telemetry could not be recorded.", 400);
  }
}
