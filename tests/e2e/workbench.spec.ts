import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseIntent } from "../../src/domain/intent";
import type { Plan } from "../../src/domain/contracts";

test("captured research flow keeps evidence and economics distinct", async ({ page }) => {
  const researchRequests: string[] = [];
  const recomputeRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/research")) researchRequests.push(request.url());
    if (request.url().endsWith("/api/recompute")) recomputeRequests.push(request.url());
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Stress-test the trade behind the headline." })).toBeVisible();
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();

  await expect(page.getByRole("heading", { name: "Evidence behind your thesis" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".evidence-card .panel-summary")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Economics under your assumptions" })).toBeVisible();
  await expect(page.getByText("Captured example at")).toBeVisible();
  await expect(page.getByText("Goal threshold")).toBeVisible();
  expect(researchRequests).toHaveLength(1);

  await page.getByRole("button", { name: "+1%" }).click();
  await expect(page.getByText("This report is from an earlier plan or market mode.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Markdown" })).toBeDisabled();

  await page.getByLabel("Follow-up edit").fill("Halve the amount");
  await page.getByRole("button", { name: "Apply edit" }).click();
  await expect(page.locator("#notional")).toHaveValue("5000");
  await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeEnabled();
  await expect.poll(() => recomputeRequests.length).toBe(1);
  expect(researchRequests).toHaveLength(1);
});

test("goal change preserves evidence and recomputes threshold", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();
  await expect(page.getByRole("heading", { name: "Evidence behind your thesis" })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Objective", { exact: true }).selectOption("break_even");
  await expect(page.getByText("This report is from an earlier plan or market mode.")).toBeVisible();
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();
  await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeEnabled();
  await expect(page.locator(".stale-banner")).toHaveCount(0);
  // Evidence verdict stays visible; economics updated without losing the brief.
  await expect(page.getByRole("heading", { name: "Evidence behind your thesis" })).toBeVisible();
});

test("depth exhaustion shows insufficient without a whole-position profit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();
  await expect(page.getByRole("heading", { name: "Economics under your assumptions" })).toBeVisible({ timeout: 30_000 });

  await page.locator("details.assumptions-disclosure summary").click();
  await page.getByLabel("Available exit depth").fill("0");
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();
  await expect(page.getByText("insufficient depth", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
});

test("threshold-only mode is reachable and labeled", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Threshold only" }).click();
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();
  await expect(page.locator(".economics-card")).toContainText(/threshold.only/i);
  await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeEnabled();
});

test("invalidation omission is shown, not invented", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel(/Invalidation/)).toBeVisible();
  await expect(page.getByText("no stop-loss invented", { exact: false })).toBeVisible();
});

test("keyboard-only flow reaches submit and export controls", async ({ page }) => {
  await page.goto("/");
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press("Tab");
    if (await page.getByRole("button", { name: "Stress-test my thesis" }).evaluate((element) => element === document.activeElement)) break;
  }
  await expect(page.getByRole("button", { name: "Stress-test my thesis" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Evidence behind your thesis" })).toBeVisible({ timeout: 30_000 });
  // Report heading receives focus for screen-reader announcement.
  await expect(page.getByRole("heading", { name: "Keep the conclusions distinct." })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Markdown", exact: true })).toBeFocused();
});

test("mobile layout does not overflow horizontally", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();
  await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeEnabled();
  const width = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(width).toBe(true);
});

test("a follow-up applied after a newer edit does not overwrite the newer plan", async ({ page }) => {
  let release!: () => void;
  let arrived!: () => void;
  let delivered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { arrived = resolve; });
  const settled = new Promise<void>((resolve) => { delivered = resolve; });
  await page.route("**/api/intent", async (route) => {
    const request = route.request().postDataJSON() as { message: string; plan: Plan };
    const patch = parseIntent(request.message, request.plan);
    arrived();
    await gate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(patch) });
    delivered();
  });
  await page.goto("/");
  await page.fill("#follow-up", "Halve the amount");
  await page.click(".follow-up button[type=submit]");
  await requested;
  await page.fill("#notional", "9000");
  release();
  await settled;
  await expect(page.locator("#notional")).toHaveValue("9000");
  await expect(page.locator("#follow-up")).toHaveValue("Halve the amount");
  await expect(page.locator(".change-banner")).toContainText("Purchase notional changed");
});

test("incomplete numeric draft survives save and restore without crashing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#notional").fill("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Restore saved", exact: true }).click();
  await expect(page.locator("#notional")).toHaveValue("");
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();
  await expect(page.locator("#notional")).toBeFocused();
  await expect(page.locator("#notional")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#purchaseNotionalExcludingFee-error")).toContainText("greater than 0");
  await page.locator("#notional").fill("100");
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();
  await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});


test("explicit evidence retry calls research instead of reusing an unavailable assessment", async ({ page }) => {
  let researchCalls = 0;
  let recomputeCalls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/research")) researchCalls += 1;
    if (request.url().endsWith("/api/recompute")) recomputeCalls += 1;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();
  await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Retry evidence assessment" }).click();
  await expect.poll(() => researchCalls).toBe(2);
  await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeEnabled();
  expect(recomputeCalls).toBe(0);
});

test("current snapshotless partial report can be exported", async ({ page }) => {
  await page.route("**/api/research", async (route) => {
    const response = await route.fetch();
    const report = await response.json();
    report.snapshot = null;
    report.instrument = null;
    report.recomputeToken = null;
    report.economicsInputHash = null;
    await route.fulfill({ response, json: report });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();
  await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeEnabled();
  await expect(page.locator(".stale-banner")).toHaveCount(0);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, "utf8"));
  expect(exported.snapshot).toBeNull();
  expect(exported).not.toHaveProperty("recomputeToken");
});

test("downloaded markdown preserves calculated warnings and position details", async ({ page }) => {
  await page.goto("/");
  await page.locator("details.assumptions-disclosure summary").click();
  await page.getByLabel("Available exit depth").fill("0");
  const responseEvent = page.waitForResponse((response) => response.url().endsWith("/api/research") && response.ok());
  await page.getByRole("button", { name: "Stress-test my thesis" }).click();
  const report = await (await responseEvent).json();
  await expect(page.getByRole("button", { name: "Markdown", exact: true })).toBeEnabled();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const download = await downloadEvent;
  const path = await download.path();
  const markdown = await readFile(path!, "utf8");
  for (const warning of report.economics.warnings) expect(markdown).toContain(warning);
  expect(markdown).toContain(report.instrument.symbol);
  expect(markdown).toContain(report.economics.unmatchedExitQuantity);
});
