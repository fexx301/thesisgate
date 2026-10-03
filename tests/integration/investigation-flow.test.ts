import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { investigateClaim } from "../../src/server/investigation";
import { lookupInvestigation } from "../../src/server/investigation-sources";
import { reserveModelBudget, resetLocalRateLimitsForTests } from "../../src/server/quota";
import type { ClaimAssessment, Plan, SourceDocument } from "../../src/domain/contracts";

vi.mock("../../src/server/investigation-sources", () => ({ lookupInvestigation: vi.fn() }));
vi.mock("../../src/server/quota", async (original) => ({ ...await original<typeof import("../../src/server/quota")>(), reserveModelBudget: vi.fn(async () => null) }));
const claim: ClaimAssessment = { claimId: "factual-1", exactText: "Tesla reported earnings today", distinction: "factual", materiality: "material", status: "insufficient", explanation: "Missing date", missingEvidence: "An earnings record", citations: [] };
const plan = { asset: "TSLA", thesis: claim.exactText, horizon: { timezone: null } } as Plan;
const source: SourceDocument = { id: "src_earnings", title: "Tesla earnings calendar", originalUrl: null, finalApprovedUrl: null, publisher: "Bitget market data", provenance: "retrieved_platform_data", publicationDate: "2026-07-22", publicationDatePrecision: "day", eventDate: null, fetchedAt: "2026-10-03T12:00:00Z", cleanedText: "Most recent results: reported 2026-07-22.", textHash: "earnings-hash", truncated: false };

beforeEach(() => {
  resetLocalRateLimitsForTests(); vi.clearAllMocks();
  vi.stubEnv("THESIS_INVESTIGATION_ENABLED", "true"); vi.stubEnv("THESIS_LLM_ENABLED", "true");
  vi.stubEnv("THESIS_LLM_API_KEY", "fake-test-key"); vi.stubEnv("THESIS_LLM_BASE_URL", "http://127.0.0.1:9999/v1/chat/completions");
  vi.stubEnv("THESIS_LLM_MODEL", "test-model"); vi.stubEnv("THESIS_LLM_PROTOCOL", "openai_chat");
  vi.mocked(lookupInvestigation).mockResolvedValue({ sources: [source], lookups: [{ source: "Bitget earnings", status: "found", detail: "Retrieved", sourceIds: [source.id] }] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("investigation through the real model/citation adapter", () => {
  it.each([true, false])("validates provider citations and uses a separate quota identity (valid quote: %s)", async (valid) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      model: "reported-model", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.002 },
      choices: [{ message: { content: JSON.stringify({
        summary: "The source contradicts the date", mostConsequentialUnknown: null,
        claims: [{ ...claim, status: "contradicted", explanation: "The actual report date is July 22", citations: [{ sourceId: source.id, excerpt: valid ? "reported 2026-07-22." : "reported 2026-10-03." }] }],
      }) } }],
    })));
    const result = await investigateClaim(plan, [claim], [], "live", new Date("2026-10-03T12:00:00Z"), { requestId: "base-brief", visitorKey: "visitor" });
    expect(reserveModelBudget).toHaveBeenCalledExactlyOnceWith({ requestId: "base-brief:investigation-v1", visitorKey: "visitor" });
    expect(result.investigation).toMatchObject({ status: valid ? "contradicted" : "insufficient", modelCalls: 1, modelUsage: { costUsd: "0.002" } });
    if (valid) {
      const citation = result.investigation.assessment!.citations[0];
      expect(source.cleanedText.slice(citation.startOffset, citation.endOffset)).toBe(citation.excerpt);
    } else expect(result.investigation.assessment).toBeNull();
  });
});
