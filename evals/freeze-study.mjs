import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFingerprint } from "../scripts/build-fingerprint.mjs";

const label = process.argv[2];
if (!label || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/.test(label)) throw new Error("Usage: npm run study:freeze -- <unique-session-label>");
const root = process.cwd();
const output = resolve(root, "evals/study/runs", label);
const paths = ["evals/study/baseline-prompt.md", "evals/practitioner-validation-sheet.md", "evals/study-packet.mjs", "fixtures/selection-probe.json", "fixtures/captured-context.json"];
const inputs = Object.fromEntries(paths.map((path) => [path, { sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }]));
let gitCommit = "unknown";
try { gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* Content fingerprint remains authoritative. */ }
mkdirSync(output, { recursive: true });
const manifest = {
  protocol: "trader-study-v2", createdAt: new Date().toISOString(), buildId: buildFingerprint(), gitCommit,
  inputs, investigationConfiguredInThisShell: process.env.THESIS_INVESTIGATION_ENABLED === "true",
  actualServedBuildVerified: false, baselineVersionRecorded: false, participants: 0,
  note: "Preparation manifest, not a completed study or production certification. Match buildId and investigation status against a fresh exported report. Record the baseline model/version and search setting before the first session. Preserve each task's exported JSON so all systems receive identical order-book data.",
};
writeFileSync(resolve(output, "freeze.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
for (const path of paths) writeFileSync(resolve(output, path.split("/").at(-1)), readFileSync(path), { flag: "wx" });
console.log(`Prepared ${output}/freeze.json (${manifest.buildId}). No sessions or results were created.`);
