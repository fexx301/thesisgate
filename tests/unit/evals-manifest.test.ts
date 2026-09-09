import { describe, expect, it } from "vitest";
// The benchmark helpers are intentionally runtime-only ESM; assertions here
// protect the frozen manifest without coupling its JSON-facing API to TS types.
import { benchmarkManifest, benchmarkManifestHash, cases, effectiveCaseInput, packetHash } from "../../evals/lib.mjs";

describe("frozen research benchmark manifest", () => {
  it("covers both supported assets and has an explicit call plan for every packet", () => {
    expect(new Set(cases.map((item: { marketPacket: { asset: string } }) => item.marketPacket.asset))).toEqual(new Set(["NVDA", "TSLA"]));
    for (const item of cases) {
      expect(benchmarkManifest.caseExecution[item.id]).toBeTruthy();
      expect(packetHash(item)).toMatch(/^[a-f0-9]{64}$/);
      expect(effectiveCaseInput(item).plans.length).toBeGreaterThan(0);
    }
  });

  it("keeps oracle fields out of the model input projection", () => {
    for (const item of cases) {
      const input = effectiveCaseInput(item);
      expect(input).not.toHaveProperty("title");
      expect(input).not.toHaveProperty("expectedOutcome");
      expect(input).not.toHaveProperty("numericExpectation");
      expect(input).not.toHaveProperty("grader");
      expect(input.source.sourceId).toBe(`src_${item.id.toLowerCase()}`);
    }
  });

  it("has a real manifest digest and frozen fixture hashes", () => {
    expect(benchmarkManifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(benchmarkManifest.fixtures["fixtures/selection-probe.json"]).toMatch(/^[a-f0-9]{64}$/);
    expect(benchmarkManifest.fixtures["fixtures/synthetic-book-v1.json"]).toMatch(/^[a-f0-9]{64}$/);
  });
});
