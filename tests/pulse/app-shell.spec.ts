import { test, expect } from "@playwright/test";
import { api, createWorkspace, openPulse, removeWorkspace, selectWorkspace, signIn } from "./pulse-helpers";
import { expectFooterLayout } from "../shared/app-shell";
import { expectProjectSwitcher } from "../shared/app-header";

test("Pulse footer stays at the bottom on short pages and follows long content", async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Pulse shell ${Date.now()}`);
  const { page, context } = await openPulse(browser, owner);
  try {
    await selectWorkspace(page, workspace.name);
    await page.getByRole("navigation", { name: "Pulse pages" }).getByRole("link", { name: "Actions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Actions", level: 1 })).toBeVisible();
    await expectProjectSwitcher(page, "pulse");
    await page.getByRole("heading", { name: "Actions", level: 1 }).click();
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expectFooterLayout(page, true);
      await expect(page.getByRole("button", { name: "Language", exact: true })).toBeInViewport();
    }
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Français" }).click();
    await expect(page.getByRole("link", { name: "Contribuer sur GitHub" })).toBeVisible();
    await page.getByRole("button", { name: "Langue", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await Promise.all(Array.from({ length: 10 }, (_, index) => api(owner, "rpc/create_pulse_action", {
      method: "POST",
      body: JSON.stringify({
        workspace: workspace.id, retro: null, grp: null, action_title: `Shell action ${index}`,
        action_description: "Action details", action_owner: owner.user.id, collaborators: [],
        due: null, action_priority: "medium", criteria: "",
      }),
    })));
    await page.reload();
    await expect(page.getByRole("article")).toHaveCount(10);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expectFooterLayout(page, false);
    }
  } finally {
    await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
