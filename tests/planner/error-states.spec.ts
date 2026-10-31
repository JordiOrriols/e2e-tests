import { test, expect } from "@playwright/test";
import { authenticatedPage, createWorkspace, removeWorkspace, selectWorkspace, signIn } from "./planner-helpers";

test("Planner workspace error uses the shared state and existing retry recovers", async ({ browser }) => {
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Error state ${Date.now()}`);
  const { page, context } = await authenticatedPage(browser, owner);
  try {
    await selectWorkspace(page, workspace.name);
    await page.route("**/rest/v1/roadmap_markers?*", (route) => route.fulfill({
      status: 400, contentType: "application/json", body: JSON.stringify({ message: "Planner request failed" }),
    }));
    await page.reload();
    const alert = page.locator('[data-slot="error-state"]').filter({ hasText: "Planner request failed" });
    await expect(alert).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(alert.getByRole("button", { name: "Retry", exact: true })).toBeInViewport();
    await page.unroute("**/rest/v1/roadmap_markers?*");
    await alert.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Workspace", exact: true })).toBeVisible();
  } finally {
    await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
