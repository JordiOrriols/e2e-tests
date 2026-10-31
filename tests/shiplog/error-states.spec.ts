import { test, expect } from "@playwright/test";
import { authenticatedPage, createWorkspace, removeWorkspace, selectWorkspace, signIn } from "../planner/planner-helpers";

test("Shiplog shared query error keeps localized copy and retry restores content", async ({ browser }) => {
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Error state ${Date.now()}`);
  const { page, context } = await authenticatedPage(browser, owner, "http://127.0.0.1:5178");
  try {
    await selectWorkspace(page, workspace.name);
    await page.evaluate(() => localStorage.setItem("i18nextLng", "fr"));
    await page.route("**/rest/v1/shiplog_applications?*", (route) => route.fulfill({
      status: 400, contentType: "application/json", body: JSON.stringify({ message: "Shiplog access required" }),
    }));
    await page.getByRole("link", { name: "Applications", exact: true }).click();
    await page.reload();
    const alert = page.locator('[data-slot="error-state"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Un accès à Shiplog est requis");
    await expect(alert).not.toContainText("Shiplog access required");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(alert.getByRole("button", { name: "Réessayer", exact: true })).toBeInViewport();
    await page.unroute("**/rest/v1/shiplog_applications?*");
    await alert.getByRole("button", { name: "Réessayer", exact: true }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nouvelle application", exact: true })).toBeVisible();
  } finally {
    await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
