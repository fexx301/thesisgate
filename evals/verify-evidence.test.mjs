import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { scoreReport } from "./scoring.mjs";
import { verifyHistoricalEvidence } from "./verify-evidence.mjs";

const publishedRoot = fileURLToPath(new URL("../evidence/benchmark-gate-final/", import.meta.url));
function withBundle(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "thesisgate-evidence-"));
  try {
    fs.cpSync(publishedRoot, root, { recursive: true });
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function updateFileAndInventory(root, name, change) {
  const value = JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  change(value);
  const bytes = JSON.stringify(value);
  fs.writeFileSync(path.join(root, name), bytes);
  const inventoryPath = path.join(root, "integrity-manifest.json");
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  inventory.files.find((entry) => entry.path === name).sha256 = createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory));
}
function scoredCases(omissions) {
  return {
    scoringMethod: "builder",
    cases: Array.from({ length: 12 }, (_, index) => ({
      completeCorrect: true, numericChecksPass: true, noMaterialFabrication: true,
      correctedOmissions: omissions[index] ?? [],
    })),
  };
}

test("the same omission across multiple cases cannot meet the three-unique-omission gate", () => {
  const result = scoreReport(scoredCases([["forecast_support"], ["forecast_support"], ["forecast_support"]]));
  assert.equal(result.omissionsCorrected, 1);
  assert.equal(result.passed, false);
});
test("three distinct omissions meet the unchanged threshold only with all other conditions", () => {
  const report = scoredCases([["forecast_support"], ["causal_support"], ["depth_sufficiency"]]);
  assert.equal(scoreReport(report).passed, true);
  report.cases[0].noMaterialFabrication = false;
  assert.equal(scoreReport(report).passed, false);
  report.cases[0].noMaterialFabrication = true;
  report.cases[0].numericChecksPass = false;
  assert.equal(scoreReport(report).passed, false);
  report.cases[0].numericChecksPass = true;
  report.cases.slice(0, 3).forEach((item) => { item.completeCorrect = false; });
  assert.equal(scoreReport(report).passed, false);
});
test("published historical integrity is independent of current code and does not imply performance success", () => {
  const result = verifyHistoricalEvidence();
  assert.equal(result.artifactCount, 36);
  assert.equal(result.currentImplementationVerified, false);
  assert.equal(result.independentGrading, false);
  assert.equal(result.score.completeCorrect, 11);
  assert.equal(result.score.omissionsCorrected, 0);
  assert.equal(result.score.passed, false);
});
test("a missing or changed referenced artifact fails integrity", () => {
  withBundle((root) => {
    fs.rmSync(path.join(root, "candidate/E01.json"));
    assert.throws(() => verifyHistoricalEvidence(root));
  });
  withBundle((root) => {
    fs.appendFileSync(path.join(root, "candidate/E01.json"), " ");
    assert.throws(() => verifyHistoricalEvidence(root), /SHA-256 mismatch/);
  });
});
test("paired citations must match exact content even if review inventory digest is updated", () => {
  withBundle((root) => {
    updateFileAndInventory(root, "correction-review.json", (review) => {
      review.cases[0].citations[1].excerpt = "An invented baseline omission";
    });
    assert.throws(() => verifyHistoricalEvidence(root), /excerpt mismatch/);
  });
});
test("historical implementation hash cannot be silently rebound", () => {
  withBundle((root) => {
    updateFileAndInventory(root, "run-manifest.json", (run) => { run.implementationHash = "a".repeat(64); });
    assert.throws(() => verifyHistoricalEvidence(root), /Historical run binding mismatch/);
  });
});
test("a bundle artifact symlink cannot escape its root", () => {
  withBundle((root) => {
    fs.rmSync(path.join(root, "candidate/E01.json"));
    fs.symlinkSync(path.join(publishedRoot, "candidate/E01.json"), path.join(root, "candidate/E01.json"));
    assert.throws(() => verifyHistoricalEvidence(root), /escapes bundle/);
  });
});
