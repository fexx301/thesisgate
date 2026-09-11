import { z } from "zod";

export const TelemetryEventNameSchema = z.enum([
  "session_started",
  "brief_submitted",
  "brief_completed",
  "brief_failed",
  "follow_up_applied",
  "draft_saved",
  "draft_restored",
  "draft_cleared",
  "live_refresh_requested",
  "export_downloaded",
]);

export const TelemetryEventSchema = z
  .object({
    event: TelemetryEventNameSchema,
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
    occurredAt: z.string().datetime({ offset: true }),
    durationMs: z.number().int().nonnegative().max(900_000).optional(),
    outcome: z.enum(["success", "error", "cancelled"]).optional(),
    marketMode: z.enum(["captured_real", "live"]).optional(),
    evidenceStatus: z.enum(["assessed", "not_assessed", "unavailable"]).optional(),
    computationStatus: z
      .enum(["calculated", "threshold_only", "missing_inputs", "invalid_instrument", "invalid_book", "insufficient_depth"])
      .optional(),
    reusedEvidence: z.boolean().optional(),
    modelConfigured: z.boolean().optional(),
    errorKind: z.enum(["validation", "network", "provider", "unknown"]).optional(),
  })
  .strict();

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
