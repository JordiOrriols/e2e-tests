import { test, expect, type BrowserContext } from "@playwright/test";
import { api, authenticatedPage, createRoster, createWorkspace, removeWorkspace, selectWorkspace, signIn, addFeatures } from "./planner-helpers";
import { expectSingleModalScroll } from "../helpers/modal-scroll";

test("Planner list and calibration modals use one scroll owner", async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Modal scroll ${Date.now()}`);
  let context: BrowserContext | undefined;
  try {
    await createRoster(owner, "Team", undefined, workspace.id);
    await api(owner, `workspaces?id=eq.${workspace.id}`, {
      method: "PATCH", body: JSON.stringify({ sprint_start_date: "2026-01-05" }),
    });
    await addFeatures(owner, workspace.id, Array.from({ length: 15 }, (_, index) => ({
      name: `Feature ${index}`, in_backlog: false, backend_devs: 1, backend_weeks: 1,
    })));
    await api(owner, "roadmap_markers", { method: "POST", body: JSON.stringify(
      Array.from({ length: 15 }, (_, index) => ({ workspace_id: workspace.id, name: `Marker ${index}`, date: "2026-11-01" }))
    ) });
    const opened = await authenticatedPage(browser, owner);
    context = opened.context;
    const page = opened.page;
    await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
    await page.reload();
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Roadmap", exact: true }).click();
    await page.getByRole("button", { name: "Manage markers", exact: true }).click();
    await expectSingleModalScroll(page, page.getByRole("dialog"), "Close", true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Add feature", exact: true }).first().click();
    await expectSingleModalScroll(page, page.getByRole("dialog"), "Close", true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await page.getByRole("button", { name: "Calibrate velocity", exact: true }).click();
    const dialog = page.getByRole("dialog");
    for (let index = 0; index < 10; index++) {
      await dialog.getByRole("button", { name: "Add sprint", exact: true }).click();
      await dialog.getByLabel("Delivered story points", { exact: true }).last().fill("10");
    }
    await expectSingleModalScroll(page, dialog, "Save calibration", true);
    await dialog.getByRole("button", { name: "Save calibration", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await context?.close();
    await removeWorkspace(owner, workspace.id);
  }
});
