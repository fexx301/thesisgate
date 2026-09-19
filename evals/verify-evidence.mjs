import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { scoreReport } from "./scoring.mjs";

const defaultRoot = fileURLToPath(new URL("../evidence/benchmark-gate-final/", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashPattern = /^[a-f0-9]{64}$/;
const artifactKeys = new Set([
  "caseId", "packetHash", "runType", "status", "recordedAt", "latencyMs", "attempts", "output",
  "formulaVersion", "modelVersion", "promptVersion", "promptHash", "effectiveInputHash",
  "inputProjectionHash", "inferenceConfigHash", "sourceHash", "marketHash", "manifestHash",
  "implementationHash", "requestId", "transport", "usage", "error",
]);
const sensitiveKey = /(authorization|api[_-]?key|secret|password|cookie|headers?|environment|process\.env|access[_-]?token|refresh[_-]?token)/i;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function inspectArtifact(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    requireCondition(!sensitiveKey.test(key), `Sensitive artifact field: ${key}`);
    inspectArtifact(child);
  }
}

function readWithin(root, relativePath) {
  requireCondition(typeof relativePath === "string" && relativePath.length > 0 && !path.isAbsolute(relativePath), "Evidence path must be relative");
  const rootReal = fs.realpathSync(root);
  const resolved = fs.realpathSync(path.resolve(root, relativePath));
  const relative = path.relative(rootReal, resolved);
  requireCondition(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "Evidence path escapes bundle");
  const bytes = fs.readFileSync(resolved);
  requireCondition(bytes.byteLength <= 5_000_000, "Evidence file exceeds 5 MB");
  return bytes;
}

function pointerValue(value, pointer) {
  requireCondition(typeof pointer === "string" && pointer.startsWith("/"), "Citation needs a JSON pointer");
  return pointer.slice(1).split("/").reduce((node, key) => node?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], value);
}

// Validates a published historical record, never the implementation currently on disk.
// Hashes establish local byte consistency, not independent authorship or grading.
export function verifyHistoricalEvidence(root = defaultRoot) {
  const inventory = JSON.parse(readWithin(root, "integrity-manifest.json"));
  requireCondition(inventory.scope === "historical-only", "Inventory must be explicitly historical");
  requireCondition(hashPattern.test(inventory.implementationHash), "Historical implementation hash missing");
  requireCondition(Array.isArray(inventory.files), "Inventory files missing");
  const files = new Map();
  for (const entry of inventory.files) {
    requireCondition(!files.has(entry.path), "Duplicate inventory path");
    requireCondition(hashPattern.test(entry.sha256), "Invalid inventory digest");
    const bytes = readWithin(root, entry.path);
    requireCondition(digest(bytes) === entry.sha256, `Evidence SHA-256 mismatch: ${entry.path}`);
    files.set(entry.path, { bytes, json: JSON.parse(bytes) });
  }
  const get = (name) => {
    requireCondition(files.has(name), `Missing inventory file: ${name}`);
    return files.get(name).json;
  };
  const report = get("report.scored.json");
  const original = get("report.original.json");
  const run = get("run-manifest.json");
  const originalRun = get("run-manifest.original.json");
  const manifest = get("benchmark-manifest.json");
  const review = get("correction-review.json");
  const manifestHash = digest(files.get("benchmark-manifest.json").bytes);
  requireCondition(manifestHash === inventory.benchmarkManifestHash, "Frozen manifest hash mismatch");
  requireCondition(report.benchmarkManifestHash === manifestHash && original.benchmarkManifestHash === manifestHash, "Report manifest binding mismatch");
  for (const runManifest of [run, originalRun]) {
    requireCondition(runManifest.implementationHash === inventory.implementationHash && runManifest.benchmarkManifestHash === manifestHash, "Historical run binding mismatch");
  }
  requireCondition(report.artifactRoot === "evidence/benchmark-gate-final" && run.artifactRoot === report.artifactRoot, "Published artifactRoot is incorrect");
  requireCondition(report.evidenceScope?.startsWith("historical-only") && run.evidenceScope?.startsWith("historical-only"), "Historical scope label missing");
  requireCondition(report.status === "scored-final" && report.scoringMethod === "builder", "Expected historical builder scoring");
  const caseIds = Object.keys(manifest.caseExecution);
  requireCondition(caseIds.length === 12 && report.cases.length === caseIds.length && original.cases.length === caseIds.length, "Expected all 12 historical case pairs");
  requireCondition(JSON.stringify(run.selectedCases) === JSON.stringify(caseIds), "Run case list mismatch");
  const taxonomy = new Set(manifest.omissionTaxonomy);
  const expectedPaths = new Set(["report.scored.json", "report.original.json", "run-manifest.json", "run-manifest.original.json", "benchmark-manifest.json", "correction-review.json"]);
  let artifactCount = 0;
  for (const [index, record] of report.cases.entries()) {
    const oldRecord = original.cases[index];
    requireCondition(record.caseId === caseIds[index] && record.caseId === oldRecord.caseId, "Case order/identity mismatch");
    for (const key of Object.keys(oldRecord)) {
      if (["baselineOmissions", "correctedOmissions", "omissionsCorrected", "graderRationale"].includes(key)) continue;
      requireCondition(JSON.stringify(record[key]) === JSON.stringify(oldRecord[key]), `Historical judgment/artifact changed: ${record.caseId}.${key}`);
    }
    for (const key of ["baselineOmissions", "correctedOmissions"]) {
      requireCondition(Array.isArray(record[key]) && record[key].every((id) => taxonomy.has(id)), `Unknown omission ID: ${record.caseId}`);
      requireCondition(new Set(record[key]).size === record[key].length, `Duplicate case omission: ${record.caseId}`);
      requireCondition(record[key].every((id) => oldRecord[key].includes(id)), "Correction may only withdraw credits, not invent grading");
    }
    requireCondition(record.correctedOmissions.every((id) => record.baselineOmissions.includes(id)), "Correction not in baseline omissions");
    requireCondition(record.omissionsCorrected === record.correctedOmissions.length, "Per-case omission count mismatch");
    const scoring = record.scoring;
    requireCondition(record.completeCorrect === (scoring.evidenceAssessmentCorrect && scoring.economicsInterpretationCorrect && scoring.failureBehaviorCorrect), "Correctness flags disagree");
    requireCondition(record.noMaterialFabrication === scoring.noMaterialFabrication, "Fabrication flags disagree");
    const pair = [];
    for (const [field, kind] of [["candidate", "candidate"], ["generalBaseline", "general-baseline"], ["calculator", "calculator"]]) {
      const descriptor = record[field];
      requireCondition(descriptor.path === `${kind}/${record.caseId}.json`, "Unexpected case artifact path");
      const artifact = get(descriptor.path);
      expectedPaths.add(descriptor.path);
      requireCondition(digest(files.get(descriptor.path).bytes) === descriptor.sha256, "Report artifact digest mismatch");
      requireCondition(Object.keys(artifact).every((key) => artifactKeys.has(key)), "Unsupported artifact field");
      inspectArtifact(artifact);
      requireCondition(artifact.caseId === record.caseId && artifact.packetHash === record.packetHash, "Artifact case binding mismatch");
      requireCondition(artifact.manifestHash === manifestHash && artifact.implementationHash === inventory.implementationHash, "Artifact historical binding mismatch");
      requireCondition(artifact.runType === (field === "generalBaseline" ? "general_baseline" : kind), "Artifact run type mismatch");
      for (const key of ["packetHash", "effectiveInputHash", "inputProjectionHash", "sourceHash", "marketHash", "inferenceConfigHash"]) {
        requireCondition(hashPattern.test(artifact[key]), `Missing artifact hash: ${key}`);
      }
      const plannedCalls = field === "calculator" ? 0 : manifest.caseExecution[record.caseId][field === "candidate" ? "candidateCalls" : "baselineCalls"];
      requireCondition(artifact.attempts === plannedCalls, "Historical provider-call plan mismatch");
      if (field !== "calculator") {
        requireCondition(artifact.modelVersion === report.modelVersion, "Model version mismatch");
        requireCondition(artifact.promptVersion === (field === "candidate" ? report.promptVersion : report.generalBaseline.promptVersion), "Prompt version mismatch");
        pair.push(artifact);
      } else {
        requireCondition(artifact.formulaVersion === report.calculatorVersion, "Calculator version mismatch");
      }
      artifactCount++;
    }
    for (const key of ["effectiveInputHash", "inputProjectionHash", "sourceHash", "marketHash", "inferenceConfigHash"]) {
      requireCondition(pair[0][key] === pair[1][key], "Candidate/baseline input fairness mismatch");
    }
  }
  requireCondition(artifactCount === 36 && inventory.artifactCount === artifactCount, "Expected all 36 referenced artifacts");
  requireCondition(files.size === expectedPaths.size && [...files.keys()].every((name) => expectedPaths.has(name)), "Unexpected/missing inventory files");
  requireCondition(review.cases.length === caseIds.length, "Review must cover all pairs");
  for (const [index, correction] of review.cases.entries()) {
    const record = report.cases[index];
    requireCondition(correction.caseId === record.caseId, "Review case mismatch");
    const removed = original.cases[index].correctedOmissions.filter((id) => !record.correctedOmissions.includes(id));
    requireCondition(JSON.stringify(removed) === JSON.stringify(correction.removedOmissionIds), "Withdrawal provenance mismatch");
    requireCondition(correction.citations.length === 2, "Paired citations required");
    for (const [side, citation] of correction.citations.entries()) {
      requireCondition(citation.path === `${side === 0 ? "candidate" : "general-baseline"}/${record.caseId}.json`, "Citation must reference each side of the pair");
      requireCondition(typeof citation.excerpt === "string" && pointerValue(get(citation.path), citation.pointer) === citation.excerpt, "Paired citation excerpt mismatch");
    }
  }
  const score = scoreReport(report);
  requireCondition(review.supportedUniqueOmissions === score.omissionsCorrected && review.historicalPerformanceGate === (score.passed ? "passed" : "failed"), "Correction summary disagrees with score");
  return { scope: "historical-only", artifactCount, implementationHash: inventory.implementationHash, currentImplementationVerified: false, independentGrading: false, score };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireCondition(args.length === 0 || (args.length === 1 && args[0] === "--performance"), "Usage: node evals/verify-evidence.mjs [--performance]");
    const result = verifyHistoricalEvidence();
    console.log("HISTORICAL_EVIDENCE_INTEGRITY=verified");
    console.log("CURRENT_IMPLEMENTATION_PERFORMANCE=not_verified");
    console.log(JSON.stringify(result, null, 2));
    if (args.includes("--performance")) {
      console.log(`HISTORICAL_RESEARCH_GATE=${result.score.passed ? "passed" : "failed"}`);
      if (!result.score.passed) process.exitCode = 1;
    }
  } catch (error) {
    console.error("HISTORICAL_EVIDENCE_INTEGRITY=invalid");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
