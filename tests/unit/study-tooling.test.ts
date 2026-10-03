import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const temp = () => { const root = mkdtempSync(resolve(tmpdir(), "thesisgate-study-")); roots.push(root); return root; };

describe("study artifacts", () => {
  it("strips candidate answers and tokens from comparison packets", () => {
    const root = temp();
    const report = {
      reportId: "report_test", buildId: "tg-example", confirmedPlan: { thesis: "Check this fact" },
      instrument: { symbol: "RNVDAUSDT" }, snapshot: { bids: [["1", "2"]], asks: [["2", "3"]], hash: "snapshot-hash", mode: "captured_real", receivedAt: "2026-09-08T21:51:19Z" },
      recomputeToken: "do-not-export", claims: [{ exactText: "candidate verdict" }], economics: { requiredGoalShift: "answer" },
      sources: [{ id: "source", cleanedText: "original source text" }], investigation: { asOf: "2026-09-08T21:51:19Z", explanation: "candidate finding" },
    };
    const input = resolve(root, "report.json"); writeFileSync(input, JSON.stringify(report));
    for (const mode of ["workflow", "equal-data"]) {
      execFileSync(process.execPath, [resolve("evals/study-packet.mjs"), input, "case-a", mode], { cwd: root });
      const packet = JSON.parse(readFileSync(resolve(root, `evals/study/runs/case-a/${mode}-inputs.json`), "utf8"));
      expect(packet.snapshot).toEqual(report.snapshot);
      expect(packet.referenceTime).toBe(report.investigation.asOf);
      for (const leaked of ["do-not-export", "candidate verdict", "candidate finding", "requiredGoalShift"]) expect(JSON.stringify(packet)).not.toContain(leaked);
      expect(packet.suppliedSources).toHaveLength(mode === "equal-data" ? 1 : 0);
      expect(() => execFileSync(process.execPath, [resolve("evals/study-packet.mjs"), input, "case-a", mode], { cwd: root, stdio: "pipe" })).toThrow();
    }
  });
  it("fingerprints source changes, excludes environment secrets, and freezes without claiming participants", () => {
    const root = temp();
    for (const dir of ["src", "fixtures", "public", "evals/study"]) mkdirSync(resolve(root, dir), { recursive: true });
    for (const path of ["evals/study/baseline-prompt.md", "evals/practitioner-validation-sheet.md", "evals/study-packet.mjs", "fixtures/selection-probe.json", "fixtures/captured-context.json"]) writeFileSync(resolve(root, path), "test input");
    const fingerprint = () => execFileSync(process.execPath, [resolve("scripts/build-fingerprint.mjs")], { cwd: root, encoding: "utf8" });
    const before = fingerprint();
    writeFileSync(resolve(root, ".env.local"), "FAKE_TEST_SECRET=not-a-real-secret");
    expect(fingerprint()).toBe(before);
    writeFileSync(resolve(root, "src/change.ts"), "export const value = 1;");
    expect(fingerprint()).not.toBe(before);
    execFileSync(process.execPath, [resolve("evals/freeze-study.mjs"), "test-cohort"], { cwd: root, stdio: "pipe" });
    const manifest = JSON.parse(readFileSync(resolve(root, "evals/study/runs/test-cohort/freeze.json"), "utf8"));
    expect(manifest).toMatchObject({ buildId: fingerprint(), participants: 0, actualServedBuildVerified: false });
    expect(JSON.stringify(manifest)).not.toContain("FAKE_TEST_SECRET");
  });
});
