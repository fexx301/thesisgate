import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [input, label, mode = "workflow"] = process.argv.slice(2);
if (!input || !label || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/.test(label) || !["workflow", "equal-data"].includes(mode)) {
  throw new Error("Usage: npm run study:packet -- <exported-report.json> <unique-task-label> [workflow|equal-data]");
}
const report = JSON.parse(readFileSync(resolve(input), "utf8"));
if (!report.confirmedPlan || !report.instrument || !report.snapshot || !Array.isArray(report.snapshot.bids) || !Array.isArray(report.snapshot.asks)) {
  throw new Error("A report with a confirmed plan, instrument and frozen bid/ask snapshot is required.");
}
// Explicitly project inputs; never give the comparison system candidate answers or capability tokens.
const packet = {
  protocol: "trader-study-v2", comparison: mode,
  referenceTime: report.investigation?.asOf ?? report.snapshot.receivedAt,
  marketMode: report.snapshot.mode,
  plan: report.confirmedPlan, instrument: report.instrument, snapshot: report.snapshot,
  underlying: report.marketContext?.underlying ?? null,
  session: report.marketContext?.session ?? null,
  suppliedSources: mode === "equal-data" ? (report.sources ?? []).map((source) => ({
    id: source.id, title: source.title, publisher: source.publisher, originalUrl: source.originalUrl,
    publicationDate: source.publicationDate, eventDate: source.eventDate, fetchedAt: source.fetchedAt,
    provenance: source.provenance, cleanedText: source.cleanedText, truncated: source.truncated,
  })) : [],
  task: "Research the exact thesis. Calculate break-even and the goal threshold from this snapshot under the plan assumptions, including fees, quantity steps and venue limits. Distinguish required moves from forecasts and old publication from event timing. Report unknowns and cite the evidence.",
};
const bytes = JSON.stringify(packet, null, 2) + "\n";
const output = resolve("evals/study/runs", label);
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, `${mode}-inputs.json`), bytes, { flag: "wx" });
writeFileSync(resolve(output, `${mode}-provenance.json`), JSON.stringify({
  reportId: report.reportId, buildId: report.buildId ?? "unversioned", snapshotHash: report.snapshot.hash,
  inputSha256: createHash("sha256").update(bytes).digest("hex"), sourceReportSha256: createHash("sha256").update(readFileSync(resolve(input))).digest("hex"),
  note: "Facilitator provenance only. Attach the inputs file to Claude, not this record or the original report.",
}, null, 2) + "\n", { flag: "wx" });
console.log(`Prepared ${output}/${mode}-inputs.json. No baseline answer or study result was generated.`);
