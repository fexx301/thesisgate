import { IntentRequestSchema } from "@/domain/contracts";
import { parseIntent } from "@/domain/intent";
import { assertAllowedOrigin, jsonError, parseJsonRequest, RequestOriginError, RequestValidationError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertAllowedOrigin(request);
    const input = await parseJsonRequest(request, IntentRequestSchema, 20_000);
    return Response.json(parseIntent(input.message, input.plan), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestOriginError) return jsonError(error.message, 403);
    if (error instanceof RequestValidationError) return jsonError(error.message, 400);
    return jsonError("The follow-up could not be parsed.", 400);
  }
}
