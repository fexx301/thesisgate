// Renders a Markdown report for a comparison run.
// Usage: node evals/e2e/report.mjs <results-dir>
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node evals/e2e/report.mjs <results-dir>");
const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
const cases = fs.readdirSync(path.join(dir, "cases")).sort().map((file) => JSON.parse(fs.readFileSync(path.join(dir, "cases", file), "utf8")));
const names = { thesisgate: "ThesisGate", chatbot: "Chatbot (sources only)", chatbot_with_data: "Chatbot + same data" };
const systems = Object.keys(names);
const row = (label, pick) => `| ${label} | ${systems.map((system) => pick(summary.systems[system])).join(" | ")} |`;
const numeric = (value) => `${value.correct} correct, ${value.wrong} wrong, ${value.missing} missing`;

const lines = [
  `# End-to-end comparison: ${summary.runId}`,
  "",
  `${summary.cases} real trader messages. Every system uses ${summary.contestantModel}. The blind judge is ${summary.judgeModel} (a different vendor), and answer order is shuffled per case. Numbers are scored by code against the production calculator with a tolerance of max(0.05 percentage points, 10%).`,
  "",
  `| Measure | ${systems.map((system) => names[system]).join(" | ")} |`,
  `| --- | ${systems.map(() => "---").join(" | ")} |`,
  row("Answers with a misleading error (lower is better)", (s) => `${s.misleadingAnswers}/${summary.cases}`),
  row("Treated old news as new", (s) => s.oldNewsAsNew),
  row("Presented unsupported claims as established", (s) => s.unsupportedAsEstablished),
  row("Missed a contradicted claim", (s) => s.missedContradiction),
  row("Fabricated a fact or number", (s) => s.fabrication),
  row("Gave advice or its own forecast", (s) => s.adviceOrForecast),
  row("Addressed how far price already moved", (s) => s.addressesAlreadyMoved),
  row("Break-even move", (s) => numeric(s.breakEven)),
  row("Goal move", (s) => numeric(s.goal)),
  row("Move since the US close", (s) => numeric(s.moveSinceClose)),
  "",
  `ThesisGate's conversational parse got the asset right ${summary.thesisgateParse.asset}/${summary.thesisgateParse.of} times, the amount ${summary.thesisgateParse.notional}/${summary.thesisgateParse.of}, and the goal ${summary.thesisgateParse.goal}/${summary.thesisgateParse.of}. Its numbers use that parse, so a parse error shows up as a wrong number.`,
  "",
  "A misleading error is any of: old news treated as new, an unsupported claim presented as established, a missed contradiction, or a fabrication.",
  "",
  "## Per case",
  "",
];
for (const record of cases) {
  lines.push(`### ${record.caseId}: ${record.message}`, "", `Truth: isNewEvent=${JSON.stringify(record.truth.isNewEvent)}; ${record.truth.eventNote}`, "");
  for (const system of systems) {
    const verdict = record.judge.judgement[system] ?? {};
    const flags = ["oldNewsAsNew", "unsupportedAsEstablished", "missedContradiction", "fabrication", "adviceOrForecast"].filter((key) => verdict[key] === true);
    const numbers = record.numberScores[system];
    lines.push(`- **${names[system]}**: ${flags.length ? `flags ${flags.join(", ")}` : "no error flags"}; numbers break-even ${numbers.breakEven}, goal ${numbers.goal}, move-since-close ${numbers.moveSinceClose}. ${verdict.note ?? ""}`);
  }
  lines.push("");
}
lines.push("## Limitations", "",
  "- The cases, ground truth and rubric were written by the builder, with assistant help. The judge is a model, not an independent human panel.",
  "- ThesisGate's numbers come from the same calculator used as ground truth; the numeric rows measure whether the other systems can reproduce them.",
  "- The chatbot baselines cannot browse. In the real world a trader's chatbot might, which could change the \"sources only\" results.",
  "- ThesisGate's answer is structured and the baselines write prose, so the judge may be able to tell them apart despite the shuffling.",
  "");
fs.writeFileSync(path.join(dir, "REPORT.md"), lines.join("\n"));
console.log(path.join(dir, "REPORT.md"));
