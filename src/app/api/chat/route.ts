import { CHAT_REQUEST_MAX_BYTES, ChatRequestSchema } from "@/domain/contracts";
import { runChatTurn } from "@/server/agent";
import { assertAllowedOrigin, checkRouteRateLimit, jsonError, parseJsonRequest, requestContext, RequestOriginError, RequestValidationError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertAllowedOrigin(request);
    const context = requestContext(request);
    checkRouteRateLimit(context.visitorKey, "chat");
    const input = await parseJsonRequest(request, ChatRequestSchema, CHAT_REQUEST_MAX_BYTES);
    return Response.json(await runChatTurn(input, context), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestOriginError) return jsonError(error.message, 403);
    if (error instanceof RequestValidationError) return jsonError(error.message, error.status);
    return jsonError("That message could not be processed.", 500);
  }
}
