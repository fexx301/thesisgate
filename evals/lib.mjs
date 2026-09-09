import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const cases = JSON.parse(fs.readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
export const benchmarkManifest = JSON.parse(fs.readFileSync(new URL("./benchmark-manifest.json", import.meta.url), "utf8"));

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestBytes = fs.readFileSync(new URL("./benchmark-manifest.json", import.meta.url));
export const benchmarkManifestHash = sha256(manifestBytes);

export function implementationHash() {
  const files = benchmarkManifest.implementationFiles;
  if (!Array.isArray(files) || files.some((file) => typeof file !== "string" || !file.trim())) {
    throw new Error("Benchmark implementation file list is invalid");
  }
  return sha256(canonicalJson(files.map((file) => ({
    file,
    sha256: sha256(fs.readFileSync(path.resolve(projectRoot, file))),
  }))));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function rawPacketHash(packet) {
  return sha256(canonicalJson(packet));
}

function fixturePath(reference) {
  if (typeof reference !== "string" || !reference.trim()) throw new Error("A benchmark fixture reference is required");
  const normalized = reference.startsWith("fixtures/") ? reference : `fixtures/${reference}`;
  return normalized.endsWith(".json") ? normalized : `${normalized}.json`;
}

export function fixtureBytesHash(reference) {
  const relativePath = fixturePath(reference);
  const expectedHash = benchmarkManifest.fixtures?.[relativePath];
  if (!/^[a-f0-9]{64}$/i.test(expectedHash ?? "")) {
    throw new Error(`No frozen fixture hash exists for ${relativePath}`);
  }
  const bytes = fs.readFileSync(path.resolve(projectRoot, relativePath));
  const actualHash = sha256(bytes);
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(`Frozen fixture hash mismatch for ${relativePath}`);
  }
  return { relativePath, hash: actualHash };
}

function planFor(item, purchaseNotionalExcludingFee) {
  const defaults = benchmarkManifest.planDefaults;
  const task = item.task;
  const scenario = task.scenario
    ? { ...task.scenario, assumptionOrigin: defaults.scenarioAssumptionOrigin }
    : null;
  return {
    asset: item.marketPacket.asset,
    category: defaults.category,
    side: defaults.side,
    quoteCurrency: defaults.quoteCurrency,
    thesis: task.thesis,
    purchaseNotionalExcludingFee,
    horizon: defaults.horizon,
    goal: task.goal,
    exitAssumptions: {
      depthMultiplier: task.depthMultiplier,
      priceHaircut: task.priceHaircut,
      depthOrigin: defaults.depthOrigin,
      haircutOrigin: defaults.haircutOrigin,
    },
    scenario,
    invalidation: defaults.invalidation,
    feeIn: defaults.feeIn,
    feeOut: defaults.feeOut,
    feeOrigin: defaults.feeOrigin,
  };
}

/**
 * Resolve only the fields a runner is allowed to send to the product/model.
 * Oracle fields (title, expected outcome, numeric expectation, and grading)
 * are deliberately excluded from this projection.
 */
export function effectiveCaseInput(item) {
  const fixture = fixtureBytesHash(item.marketPacket.fixture);
  const notionals = Array.isArray(item.task.variants) && item.task.variants.length
    ? item.task.variants
    : [item.task.purchaseNotionalExcludingFee];
  const execution = benchmarkManifest.caseExecution?.[item.id];
  if (!execution) throw new Error(`No explicit execution plan exists for ${item.id}`);
  return {
    caseId: item.id,
    sourceMode: item.sourceMode,
    source: { sourceId: `src_${item.id.toLowerCase()}`, ...item.source },
    marketPacket: {
      ...item.marketPacket,
      fixture: fixture.relativePath,
      fixtureSha256: fixture.hash,
    },
    plans: notionals.map((notional) => planFor(item, notional)),
    followUp: item.task.followUp ?? null,
    execution,
  };
}

export function effectivePacketHash(item) {
  return sha256(canonicalJson({
    manifestVersion: benchmarkManifest.manifestVersion,
    caseProjectionVersion: benchmarkManifest.caseProjectionVersion,
    input: effectiveCaseInput(item),
  }));
}

export function packetHash(item) {
  return effectivePacketHash(item);
}

function safeChildPath(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error("Artifact paths must be non-empty relative paths");
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Artifact path escapes the configured artifact root");
  }
  return resolvedPath;
}

export function readJsonArtifact(root, relativePath, expectedHash) {
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    throw new Error("Artifact SHA-256 must be a 64-character hexadecimal digest");
  }
  const resolvedPath = safeChildPath(root, relativePath);
  const bytes = fs.readFileSync(resolvedPath);
  if (bytes.byteLength > 5_000_000) throw new Error("Artifact exceeds the 5 MB evidence limit");
  const actualHash = sha256(bytes);
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error("Artifact SHA-256 does not match the report");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Artifact must contain valid JSON");
  }
}
