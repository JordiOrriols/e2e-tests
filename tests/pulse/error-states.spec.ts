import { test, expect } from "@playwright/test";
import { createWorkspace, openPulse, removeWorkspace, selectWorkspace, signIn } from "./pulse-helpers";

test("Pulse query failures stay explicit and shared error display clears after recovery", async ({ browser }) => {
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Error state ${Date.now()}`);
  const { page, context } = await openPulse(browser, owner);
  try {
    await selectWorkspace(page, workspace.name);
    await page.route("**/rpc/list_pulse_actions", (route) => route.fulfill({
      status: 400, contentType: "application/json", body: JSON.stringify({ message: "Pulse request failed" }),
    }));
    await page.getByRole("navigation", { name: "Pulse pages" }).getByRole("link", { name: "Actions", exact: true }).click();
    const alert = page.locator('[data-slot="error-state"]').filter({ hasText: "Pulse request failed" });
    await expect(alert).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(alert).toBeInViewport();
    await page.unroute("**/rpc/list_pulse_actions");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Actions", level: 1 })).toBeVisible();
    await expect(alert).toHaveCount(0);
  } finally {
    await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
