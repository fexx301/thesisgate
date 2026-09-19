import fs from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import {
  benchmarkManifest,
  benchmarkManifestHash,
  canonicalJson,
  cases,
  effectiveCaseInput,
  implementationHash,
  packetHash,
  readJsonArtifact,
  sha256,
} from "./lib.mjs";
import { scoreReport } from "./scoring.mjs";

const requiredReportFields = [
  "reportVersion",
  "status",
  "recordedAt",
  "benchmarkManifestHash",
  "rubricVersion",
  "promptVersion",
  "modelVersion",
  "scoringMethod",
  "artifactRoot",
  "generalBaseline",
  "calculatorVersion",
  "cases",
];

const ARTIFACT_KEYS = new Set([
  "caseId",
  "packetHash",
  "runType",
  "status",
  "recordedAt",
  "latencyMs",
  "attempts",
  "output",
  "formulaVersion",
  "modelVersion",
  "promptVersion",
  "promptHash",
  "effectiveInputHash",
  "inputProjectionHash",
  "inferenceConfigHash",
  "sourceHash",
  "marketHash",
  "manifestHash",
  "implementationHash",
  "requestId",
  "transport",
  "usage",
  "error",
]);

const SENSITIVE_KEY = /(authorization|api[_-]?key|secret|password|cookie|headers?|environment|process\.env|access[_-]?token|refresh[_-]?token)/i;
const PLACEHOLDER = /^(?:replace\b|record\b|to[_ -]?be[_ -]?filled\b|00000000|<[^>]+>)/i;

function invalidReport(message) {
  console.error("RESEARCH_GATE=invalid_report");
  console.error(message);
  process.exitCode = 2;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isPlaceholder(value) {
  return typeof value !== "string" || PLACEHOLDER.test(value.trim());
}

function findSensitiveKey(value, pathParts = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findSensitiveKey(item, [...pathParts, String(index)]);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) return [...pathParts, key].join(".");
    const found = findSensitiveKey(item, [...pathParts, key]);
    if (found) return found;
  }
  return null;
}

function expectedInputHashes(item) {
  const input = effectiveCaseInput(item);
  return {
    input,
    effectiveInputHash: sha256(canonicalJson(input)),
    inputProjectionHash: sha256(canonicalJson({
      source: input.source,
      plans: input.plans,
      followUp: input.followUp,
      sourceMode: input.sourceMode,
      marketPacket: input.marketPacket,
    })),
    sourceHash: sha256(canonicalJson(input.source)),
    marketHash: sha256(canonicalJson(input.marketPacket)),
    inferenceConfigHash: sha256(canonicalJson(benchmarkManifest.inferenceConfig)),
  };
}

function validateArtifact(root, descriptor, record, expectedRunType, expectedModelVersion, expectedPromptVersion, expectedFormulaVersion, item) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) return { error: "artifact descriptor must be an object" };
  if (!isNonEmptyString(descriptor.path)) return { error: "artifact path is required" };
  if (!isHash(descriptor.sha256)) return { error: "artifact sha256 must be a 64-character hexadecimal digest" };
  let artifact;
  try {
    artifact = readJsonArtifact(root, descriptor.path, descriptor.sha256);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "artifact could not be verified" };
  }
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return { error: "artifact must be a JSON object" };
  const unknownKeys = Object.keys(artifact).filter((key) => !ARTIFACT_KEYS.has(key));
  if (unknownKeys.length) return { error: `artifact contains unsupported fields: ${unknownKeys.join(", ")}` };
  const sensitivePath = findSensitiveKey(artifact);
  if (sensitivePath) return { error: `artifact contains a sensitive field: ${sensitivePath}` };
  if (artifact.caseId !== record.caseId) return { error: "artifact caseId does not match the report case" };
  if (artifact.packetHash !== record.packetHash) return { error: "artifact packetHash does not match the fixed packet" };
  if (artifact.manifestHash !== benchmarkManifestHash) return { error: "artifact manifestHash does not match benchmark-manifest.json" };
  if (artifact.implementationHash !== implementationHash()) return { error: "artifact implementationHash does not match the frozen production/runner files" };
  if (artifact.runType !== expectedRunType) return { error: `artifact runType must be ${expectedRunType}` };
  if (!isNonEmptyString(artifact.status) || !["completed", "not_run", "unavailable", "failed"].includes(artifact.status)) return { error: "artifact status is invalid" };
  if (!isNonEmptyString(artifact.recordedAt)) return { error: "artifact recordedAt is required" };
  if (!isNonNegativeInteger(artifact.latencyMs)) return { error: "artifact latencyMs must be a non-negative integer" };
  if (!isNonNegativeInteger(artifact.attempts)) return { error: "artifact attempts must be a non-negative integer" };
  if (!("output" in artifact)) return { error: "artifact output is required" };
  if (!isHash(artifact.effectiveInputHash)) return { error: "artifact effectiveInputHash is required" };
  if (!isHash(artifact.inputProjectionHash)) return { error: "artifact inputProjectionHash is required" };
  if (!isHash(artifact.sourceHash)) return { error: "artifact sourceHash is required" };
  if (!isHash(artifact.marketHash)) return { error: "artifact marketHash is required" };
  const expectedHashes = expectedInputHashes(item);
  for (const key of ["effectiveInputHash", "inputProjectionHash", "sourceHash", "marketHash"]) {
    if (artifact[key] !== expectedHashes[key]) return { error: `artifact ${key} does not match the frozen effective input` };
  }
  if (expectedRunType === "calculator") {
    if (artifact.formulaVersion !== expectedFormulaVersion) return { error: "calculator artifact formulaVersion does not match the report" };
  } else {
    if (artifact.modelVersion !== expectedModelVersion) return { error: "model artifact modelVersion does not match the report" };
    if (artifact.promptVersion !== expectedPromptVersion) return { error: "model artifact promptVersion does not match the report" };
    if (!isHash(artifact.promptHash)) return { error: "model artifact promptHash is required" };
  }
  if (artifact.inferenceConfigHash !== expectedHashes.inferenceConfigHash) return { error: "artifact inferenceConfigHash does not match the frozen inference configuration" };
  if (artifact.error !== undefined && artifact.error !== null) {
    if (!artifact.error || typeof artifact.error !== "object" || Array.isArray(artifact.error)) return { error: "artifact error must be a small object" };
    const errorKeys = Object.keys(artifact.error);
    if (errorKeys.some((key) => !["code", "message"].includes(key))) return { error: "artifact error may contain only code and message" };
    if (!isNonEmptyString(artifact.error.code) || !isNonEmptyString(artifact.error.message) || artifact.error.message.length > 500) return { error: "artifact error is invalid or unbounded" };
  }
  if (artifact.status === "failed" && !artifact.error) return { error: "failed artifact must retain a bounded error code/message" };
  if (artifact.status === "completed" && artifact.error) return { error: "completed artifact cannot retain a failure error" };
  if (artifact.usage !== undefined && artifact.usage !== null) {
    if (!artifact.usage || typeof artifact.usage !== "object" || Array.isArray(artifact.usage)) return { error: "artifact usage must be an object" };
    if (Object.keys(artifact.usage).some((key) => !["promptTokens", "completionTokens", "totalTokens", "costUsd"].includes(key))) return { error: "artifact usage contains unsupported fields" };
  }
  return { artifact, expectedHashes };
}

function decimalApprox(actual, expected, tolerance = "0.000000001") {
  if (actual === null || actual === undefined) return false;
  try {
    return new Decimal(String(actual)).minus(new Decimal(String(expected))).abs().lte(new Decimal(tolerance));
  } catch {
    return false;
  }
}

function resultForNotional(output, notional) {
  if (!output || !Array.isArray(output.results)) return null;
  return output.results.find((result) => result?.purchaseNotionalExcludingFee === notional) ?? null;
}

function checkNumericResult(result, expectation) {
  if (!result || typeof result !== "object") return "calculator result is missing";
  if (expectation.computationStatus && result.computationStatus !== expectation.computationStatus) return "computationStatus mismatch";
  if (expectation.goalComparison && result.goalComparison !== expectation.goalComparison) return "goalComparison mismatch";
  if (expectation.scenarioComparison && result.goalComparison !== expectation.scenarioComparison) return "scenarioComparison mismatch";
  if (expectation.frictionProxyApproxUSDT && !decimalApprox(result.frictionProxy, expectation.frictionProxyApproxUSDT, "0.02")) return "frictionProxy is outside the declared tolerance";
  if (expectation.netPnlAtScenarioApproxUSDT && !decimalApprox(result.netPnl, expectation.netPnlAtScenarioApproxUSDT, "0.02")) return "scenario net PnL is outside the declared tolerance";
  if (expectation.netPnlExactUSDT && !decimalApprox(result.netPnl, expectation.netPnlExactUSDT, "0.000000001")) return "exact net PnL mismatch";
  if (expectation.requiredGoalShiftApprox && !decimalApprox(result.requiredGoalShift, expectation.requiredGoalShiftApprox, "0.000001")) return "required goal shift is outside the declared tolerance";
  if (expectation.netPnlMustBeNull === true && result.netPnl !== null) return "netPnl must be null";
  return null;
}

function validateNumericExpectation(item, calculatorOutput) {
  const expectation = item.numericExpectation ?? {};
  if (!calculatorOutput || typeof calculatorOutput !== "object") return "calculator output must be an object";
  if (expectation.variantResults) {
    for (const variant of expectation.variantResults) {
      const result = resultForNotional(calculatorOutput, variant.purchaseNotionalExcludingFee);
      const error = checkNumericResult(result, variant);
      if (error) return `${variant.purchaseNotionalExcludingFee}: ${error}`;
    }
  } else if (expectation.intentResult) {
    if (calculatorOutput.intent?.result !== expectation.intentResult) return "intent result mismatch";
    if (expectation.planMustRemainUnchanged === true && calculatorOutput.intent?.planChanged !== false) return "ambiguous intent changed the plan";
  } else {
    const result = resultForNotional(calculatorOutput, item.task.purchaseNotionalExcludingFee);
    const error = checkNumericResult(result, expectation);
    if (error) return error;
  }
  if (expectation.sourceProvenance && calculatorOutput.sourceProvenance !== expectation.sourceProvenance) return "source provenance mismatch";
  if (expectation.marketMode && calculatorOutput.marketMode !== expectation.marketMode) return "market mode mismatch";
  if (expectation.fixtureMustNotBeSilentFallback === true && calculatorOutput.fallbackUsed !== false) return "fixture fallback was not explicitly ruled out";
  return null;
}

function validateModelAssessment(output, input) {
  if (!output || typeof output !== "object" || Array.isArray(output)) return "model output wrapper is invalid";
  if (!["completed", "not_run", "unavailable", "failed"].includes(output.status)) return "model output status is invalid";
  if (output.status !== "completed") {
    if (output.assessment !== null) return "non-completed model output must have a null assessment";
    return null;
  }
  const assessment = output.assessment;
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) return "completed model output has no assessment";
  if (Object.keys(assessment).sort().join(",") !== "claims,mostConsequentialUnknown,summary") return "model assessment root keys are not exact";
  if (!isNonEmptyString(assessment.summary) || (assessment.mostConsequentialUnknown !== null && !isNonEmptyString(assessment.mostConsequentialUnknown))) return "model assessment summary is invalid";
  if (!Array.isArray(assessment.claims) || assessment.claims.length > 5) return "model claim list is invalid";
  const sourceText = input.source.text;
  const sourceId = input.source.sourceId;
  for (const claim of assessment.claims) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) return "model claim is invalid";
    if (Object.keys(claim).sort().join(",") !== "citations,claimId,distinction,exactText,explanation,materiality,missingEvidence,status") return "model claim keys are not exact";
    if (!isNonEmptyString(claim.claimId) || !isNonEmptyString(claim.exactText) || !isNonEmptyString(claim.explanation)) return "model claim text is invalid";
    if (!["factual", "causal", "forecast"].includes(claim.distinction)) return "model distinction is invalid";
    if (!["material", "contextual"].includes(claim.materiality)) return "model materiality is invalid";
    if (!["supported", "contradicted", "insufficient"].includes(claim.status)) return "model status is invalid";
    if (claim.missingEvidence !== null && typeof claim.missingEvidence !== "string") return "model missingEvidence is invalid";
    if (!Array.isArray(claim.citations) || claim.citations.length > 5) return "model citations are invalid";
    for (const citation of claim.citations) {
      if (!citation || typeof citation !== "object" || Array.isArray(citation) || Object.keys(citation).sort().join(",") !== "excerpt,sourceId") return "model citation keys are not exact";
      if (citation.sourceId !== sourceId || !isNonEmptyString(citation.excerpt) || citation.excerpt.length > 360) return "model citation source is invalid";
      const first = sourceText.indexOf(citation.excerpt);
      if (first < 0 || sourceText.indexOf(citation.excerpt, first + 1) >= 0) return "model citation does not match exactly once";
    }
    if (["supported", "contradicted"].includes(claim.status) && claim.citations.length === 0) return "supported/contradicted claim has no citation";
  }
  return null;
}

function validateReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return "Report must be a JSON object.";
  for (const field of requiredReportFields) {
    if (!(field in report)) return `Report is missing required field: ${field}`;
  }
  if (report.status !== "scored-final") return "Only a scored-final report can enter the research gate. Run manifests are unscored.";
  if (!isNonEmptyString(report.reportVersion) || isPlaceholder(report.reportVersion)) return "reportVersion must be a real version.";
  if (!isNonEmptyString(report.recordedAt)) return "recordedAt must be recorded.";
  if (report.benchmarkManifestHash !== benchmarkManifestHash) return "benchmarkManifestHash does not match benchmark-manifest.json.";
  if (report.rubricVersion !== benchmarkManifest.rubricVersion) return "rubricVersion does not match benchmark-manifest.json.";
  if (!isNonEmptyString(report.promptVersion) || isPlaceholder(report.promptVersion)) return "promptVersion must be recorded.";
  if (!isNonEmptyString(report.modelVersion) || isPlaceholder(report.modelVersion)) return "modelVersion must be a real runtime model version.";
  if (!["practitioner", "builder", "mixed"].includes(report.scoringMethod)) return "scoringMethod must be practitioner, builder, or mixed.";
  if (!isNonEmptyString(report.artifactRoot) || path.isAbsolute(report.artifactRoot)) return "artifactRoot must be a non-empty relative path.";
  if (!report.generalBaseline || typeof report.generalBaseline !== "object" || Array.isArray(report.generalBaseline)) return "generalBaseline metadata is required.";
  if (!isNonEmptyString(report.generalBaseline.modelVersion) || isPlaceholder(report.generalBaseline.modelVersion)) return "generalBaseline.modelVersion is required.";
  if (report.generalBaseline.modelVersion !== report.modelVersion) return "candidate and general baseline model versions must match.";
  if (!isNonEmptyString(report.generalBaseline.promptVersion) || isPlaceholder(report.generalBaseline.promptVersion)) return "generalBaseline.promptVersion is required.";
  if (!isHash(report.generalBaseline.inferenceConfigHash)) return "generalBaseline.inferenceConfigHash is required.";
  const expectedInferenceConfigHash = sha256(canonicalJson(benchmarkManifest.inferenceConfig));
  if (report.generalBaseline.inferenceConfigHash !== expectedInferenceConfigHash) return "generalBaseline inference configuration is not frozen to the manifest.";
  if (report.generalBaseline.sameInputs !== true || report.generalBaseline.sameCallCount !== true || report.generalBaseline.sameTokenBudget !== true || report.generalBaseline.sameToolBudget !== true) return "generalBaseline fairness assertions must be true and are also verified per artifact.";
  if (!isNonEmptyString(report.calculatorVersion) || report.calculatorVersion !== benchmarkManifest.calculatorVersion) return "calculatorVersion does not match benchmark-manifest.json.";
  if (!Array.isArray(report.cases) || report.cases.length !== cases.length) return `cases must contain exactly ${cases.length} records.`;

  const projectRoot = path.resolve(process.cwd());
  const artifactRoot = path.resolve(projectRoot, report.artifactRoot);
  const relativeArtifactRoot = path.relative(projectRoot, artifactRoot);
  if (relativeArtifactRoot === ".." || relativeArtifactRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeArtifactRoot)) return "artifactRoot must remain inside the project directory.";
  if (!fs.existsSync(artifactRoot)) return `artifactRoot does not exist: ${report.artifactRoot}`;
  const seenIds = new Set();
  for (const [index, record] of report.cases.entries()) {
    const expected = cases[index];
    if (!record || typeof record !== "object" || Array.isArray(record)) return "Each case record must be an object.";
    if (record.caseId !== expected.id || seenIds.has(record.caseId)) return `Case records must be ordered E01-E${String(cases.length).padStart(2, "0")} with no duplicates.`;
    seenIds.add(record.caseId);
    const expectedHash = packetHash(expected);
    if (record.packetHash !== expectedHash) return `${record.caseId} packetHash does not match the frozen effective packet (${expectedHash}).`;
    if (record.expectedOutcome !== expected.expectedOutcome || isPlaceholder(record.expectedOutcome)) return `${record.caseId} expectedOutcome does not match the fixed packet.`;
    const candidateResult = validateArtifact(artifactRoot, record.candidate, record, "candidate", report.modelVersion, report.promptVersion, null, expected);
    if (candidateResult.error) return `${record.caseId} candidate: ${candidateResult.error}`;
    const baselineResult = validateArtifact(artifactRoot, record.generalBaseline, record, "general_baseline", report.generalBaseline.modelVersion, report.generalBaseline.promptVersion, null, expected);
    if (baselineResult.error) return `${record.caseId} generalBaseline: ${baselineResult.error}`;
    const calculatorResult = validateArtifact(artifactRoot, record.calculator, record, "calculator", null, null, report.calculatorVersion, expected);
    if (calculatorResult.error) return `${record.caseId} calculator: ${calculatorResult.error}`;
    const candidate = candidateResult.artifact;
    const baseline = baselineResult.artifact;
    const calculator = calculatorResult.artifact;
    for (const key of ["effectiveInputHash", "inputProjectionHash", "sourceHash", "marketHash", "inferenceConfigHash"]) {
      if (candidate[key] !== baseline[key]) return `${record.caseId} candidate and baseline ${key} differ.`;
    }
    if (candidate.modelVersion !== baseline.modelVersion) return `${record.caseId} candidate and baseline model versions differ.`;
    const execution = benchmarkManifest.caseExecution[record.caseId];
    if (candidate.attempts !== execution.candidateCalls) return `${record.caseId} candidate attempt count does not match the call plan.`;
    if (baseline.attempts !== execution.baselineCalls) return `${record.caseId} baseline attempt count does not match the call plan.`;
    if (execution.candidateCalls > 0 && !["completed", "failed"].includes(candidate.status)) return `${record.caseId} candidate did not complete or record its planned assessment attempt.`;
    if (execution.baselineCalls > 0 && !["completed", "failed"].includes(baseline.status)) return `${record.caseId} baseline did not complete or record its planned assessment attempt.`;
    if (execution.candidateCalls === 0 && candidate.status !== "unavailable") return `${record.caseId} candidate failure behavior does not match the frozen call plan.`;
    if (execution.baselineCalls === 0 && baseline.status !== "unavailable") return `${record.caseId} baseline failure behavior does not match the frozen call plan.`;
    if (calculator.attempts !== 0) return `${record.caseId} calculator must not make provider calls.`;
    const candidateModelError = validateModelAssessment(candidate.output, candidateResult.expectedHashes.input);
    if (candidateModelError) return `${record.caseId} candidate output: ${candidateModelError}`;
    const baselineModelError = validateModelAssessment(baseline.output, baselineResult.expectedHashes.input);
    if (baselineModelError) return `${record.caseId} baseline output: ${baselineModelError}`;
    const numericError = validateNumericExpectation(expected, calculator.output);
    if (numericError) return `${record.caseId} calculator numeric check: ${numericError}`;
    if (record.caseId === "E11") {
      for (const artifact of [candidate, baseline]) {
        if (artifact.error?.code !== "model_unconfigured") return "E11 must record the explicit model-unconfigured dependency failure.";
      }
    }
    if (record.caseId === "E07") {
      for (const artifact of [candidate, baseline]) {
        if (artifact.output.intent?.result !== "clarification" || artifact.output.intent?.planChanged !== false) return "E07 must preserve the plan while clarifying the percentage reference.";
      }
    }
    if (!isNonEmptyString(record.observedOutcome) || isPlaceholder(record.observedOutcome)) return `${record.caseId} observedOutcome must be a completed human observation.`;
    if (!record.scoring || typeof record.scoring !== "object" || Array.isArray(record.scoring)) return `${record.caseId} scoring object is required.`;
    for (const key of ["evidenceAssessmentCorrect", "economicsInterpretationCorrect", "failureBehaviorCorrect", "noMaterialFabrication"]) {
      if (typeof record.scoring[key] !== "boolean") return `${record.caseId} scoring.${key} must be boolean.`;
    }
    const derivedCompleteCorrect = record.scoring.evidenceAssessmentCorrect && record.scoring.economicsInterpretationCorrect && record.scoring.failureBehaviorCorrect;
    const derivedNoMaterialFabrication = record.scoring.noMaterialFabrication;
    if ((candidate.status !== "completed" || baseline.status !== "completed") && derivedCompleteCorrect) return `${record.caseId} cannot be completeCorrect when a planned model assessment failed.`;
    if (record.completeCorrect !== derivedCompleteCorrect) return `${record.caseId} completeCorrect does not match structured scoring.`;
    if (record.numericChecksPass !== true) return `${record.caseId} numericChecksPass must be true only after machine validation.`;
    if (record.noMaterialFabrication !== derivedNoMaterialFabrication) return `${record.caseId} noMaterialFabrication does not match structured scoring.`;
    const taxonomy = new Set(benchmarkManifest.omissionTaxonomy);
    for (const field of ["baselineOmissions", "correctedOmissions"]) {
      if (!Array.isArray(record[field]) || !record[field].every((value) => isNonEmptyString(value) && taxonomy.has(value))) return `${record.caseId} ${field} must use known omission taxonomy IDs.`;
      if (new Set(record[field]).size !== record[field].length) return `${record.caseId} ${field} must not contain duplicates.`;
    }
    if (record.correctedOmissions.some((value) => !record.baselineOmissions.includes(value))) return `${record.caseId} corrected omissions must be a subset of baseline omissions.`;
    if (record.omissionsCorrected !== record.correctedOmissions.length) return `${record.caseId} omissionsCorrected must be derived from unique corrected omissions.`;
    if (!isNonEmptyString(record.graderRationale) || isPlaceholder(record.graderRationale)) return `${record.caseId} graderRationale must be completed.`;
    if (!Array.isArray(record.materialErrors) || !record.materialErrors.every(isNonEmptyString)) return `${record.caseId} materialErrors must be a string array.`;
    if (!["practitioner", "builder"].includes(record.grader)) return `${record.caseId} grader must be practitioner or builder.`;
    if (benchmarkManifest.scoringMethod && report.scoringMethod !== benchmarkManifest.scoringMethod) return "scoringMethod does not match the frozen manifest.";
    if (report.scoringMethod === "builder" && record.grader !== "builder") return `${record.caseId} grader does not match scoringMethod.`;
    if (report.scoringMethod === "practitioner" && record.grader !== "practitioner") return `${record.caseId} grader does not match scoringMethod.`;
  }
  return null;
}

const reportPath = process.env.THESISGATE_EVAL_REPORT;
if (!reportPath) {
  console.error("RESEARCH_GATE=pending");
  console.error(`No scored report supplied. The manifest contains ${cases.length} fixed packets:`);
  for (const item of cases) console.error(`${item.id}. ${item.title} [effective packet ${packetHash(item)}]`);
  console.error("Set THESISGATE_EVAL_REPORT to a scored-final report with hashed candidate, baseline, and calculator artifacts.");
  process.exitCode = 2;
} else {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    invalidReport(error instanceof Error ? error.message : "Report could not be read as JSON.");
  }
  if (process.exitCode !== 2) {
    const validationError = validateReport(report);
    if (validationError) {
      invalidReport(validationError);
    } else {
      const { passed, ...summary } = scoreReport(report);
      console.log(`RESEARCH_GATE=${passed ? "passed" : "failed"}`);
      console.log(JSON.stringify(summary, null, 2));
      if (!passed) process.exitCode = 1;
    }
  }
}
