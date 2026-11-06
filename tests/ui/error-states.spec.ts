import { test, expect } from "@playwright/test";

test("shared render boundary reports diagnostics and supports explicit keyboard recovery", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/iframe.html?id=views-errorboundary--recovery&viewMode=story");
  await expect(page.getByRole("alert")).toContainText("Workspace failed to render.");
  await expect(page.getByRole("heading", { name: "Unable to display workspace" })).toBeVisible();
  expect(errors.some((message) => message.includes("Error in Workspace:"))).toBe(true);
  await page.getByRole("button", { name: "Retry", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Workspace recovered.", { exact: true })).toBeVisible();
});

test("shared error states have readable messages and caller-owned disabled retry on mobile", async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/iframe.html?id=views-errorstate--default&viewMode=story");
    await expect(page.getByRole("alert")).toContainText("The request failed. Try again later.");
    await expect(page.getByRole("alert")).toBeInViewport();
    await expect(page.getByRole("button")).toHaveCount(0);
    await page.goto("/iframe.html?id=views-errorstate--busy&viewMode=story");
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeDisabled();
    await expect(page.getByRole("alert")).toBeInViewport();
    await page.goto("/iframe.html?id=views-errorboundary--healthy&viewMode=story");
    await expect(page.getByRole("button", { name: "Working action" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});
