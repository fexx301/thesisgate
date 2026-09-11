import { expect, test } from "@playwright/test";

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
  expect(researchRequests).toHaveLength(1);
  expect(recomputeRequests).toHaveLength(1);
});

test("mobile layout does not overflow horizontally", async ({ page }) => {
  await page.goto("/");
  const width = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(width).toBe(true);
});
