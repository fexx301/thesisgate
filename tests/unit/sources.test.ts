import { describe, expect, it } from "vitest";
import { MAX_SOURCE_CHARS } from "../../src/domain/contracts";
import { createPastedSourceDocument, sourceUrlStatus } from "../../src/server/sources";

describe("source provenance and bounds", () => {
  it("canonicalizes pasted text and keeps it unverified", () => {
    const source = createPastedSourceDocument({
      text: "  Heading  \r\n\r\n  A   source passage.  ",
      originalUrl: "https://nvidianews.nvidia.com/article",
      fetchedAt: "2026-09-09T00:00:00.000Z",
    });
    expect(source?.cleanedText).toBe("Heading\n\nA source passage.");
    expect(source?.provenance).toBe("user_pasted_unverified");
    expect(source?.originalUrl).toBe("https://nvidianews.nvidia.com/article");
    expect(source?.textHash).toHaveLength(64);
  });

  it("truncates source text at the model-input bound", () => {
    const source = createPastedSourceDocument({
      text: "x".repeat(MAX_SOURCE_CHARS + 100),
      fetchedAt: "2026-09-09T00:00:00.000Z",
    });
    expect(source?.truncated).toBe(true);
    expect(source?.cleanedText).toHaveLength(MAX_SOURCE_CHARS);
  });

  it("rejects unsafe or unapproved retrieval references", () => {
    expect(sourceUrlStatus("http://127.0.0.1/private").valid).toBe(false);
    expect(sourceUrlStatus("https://127.0.0.1/private").valid).toBe(false);
    expect(sourceUrlStatus("https://localhost/private").valid).toBe(false);
    expect(sourceUrlStatus("https://example.com/article").approvedHost).toBe(false);
    expect(sourceUrlStatus("https://ir.tesla.com/article").approvedHost).toBe(true);
  });
});
