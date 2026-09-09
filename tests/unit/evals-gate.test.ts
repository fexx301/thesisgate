import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("research gate boundary", () => {
  it("rejects a newly generated dry-run report as unscored", () => {
    const runnerOutput = execFileSync(process.execPath, ["--experimental-strip-types", "evals/run-runner.mjs"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        THESISGATE_EVAL_MODE: "dry_run",
        THESISGATE_EVAL_MAX_CALLS: "0",
      },
      encoding: "utf8",
      maxBuffer: 2_000_000,
    });
    const run = JSON.parse(runnerOutput) as { report: string };
    expect(run.report).toMatch(/^evals\/results\/[^/]+\/report\.unscored\.json$/);

    const validation = spawnSync(process.execPath, ["evals/run.mjs"], {
      cwd: projectRoot,
      env: { ...process.env, THESISGATE_EVAL_REPORT: run.report },
      encoding: "utf8",
    });
    expect(validation.status).toBe(2);
    expect(`${validation.stdout}${validation.stderr}`).toContain("Only a scored-final report can enter the research gate");
  });

  it("requires an explicit call cap before paid mode can start", () => {
    const validation = spawnSync(process.execPath, ["evals/run-runner.mjs"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        THESISGATE_EVAL_MODE: "paid",
        THESISGATE_ALLOW_PAID_EVAL: "1",
        THESISGATE_EVAL_CASES: "E02",
      },
      encoding: "utf8",
    });
    expect(validation.status).toBe(2);
    expect(`${validation.stdout}${validation.stderr}`).toContain("requires an explicit THESISGATE_EVAL_MAX_CALLS cap");
  });
});
