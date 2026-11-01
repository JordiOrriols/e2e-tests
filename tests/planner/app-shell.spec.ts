import { test, expect } from "@playwright/test";
import { addFeatures, authenticatedPage, createWorkspace, removeWorkspace, selectWorkspace, signIn } from "./planner-helpers";
import { expectFooterLayout } from "../shared/app-shell";
import { expectProjectSwitcher } from "../shared/app-header";

test("Planner shell retains workspace navigation, short-page footer and full-width roadmap", async ({ browser }) => {
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Planner shell ${Date.now()}`);
  const { page, context } = await authenticatedPage(browser, owner);
  try {
    await selectWorkspace(page, workspace.name);
    await expectProjectSwitcher(page, "planner");
    await page.getByRole("link", { name: "Roadmap", exact: true }).click();
    await page.setViewportSize({ width: 1600, height: 900 });
    await expectFooterLayout(page, true);
    await addFeatures(owner, workspace.id, [{ name: "Shell feature", backend_weeks: 1, backend_devs: 1 }]);
    await page.reload();
    const toggle = page.getByRole("button", { name: "Full width", exact: true });
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
    await expect(page.getByRole("main")).toHaveClass(/max-w-none/);
    expect(await page.getByRole("main").evaluate((main) => main.getBoundingClientRect().width)).toBe(1600);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("language-selector")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Workspace", exact: true })).toBeVisible();
  } finally {
    await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
