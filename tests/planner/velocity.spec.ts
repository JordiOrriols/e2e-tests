import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  api, authenticatedPage, createRoster, removeRoster, seedRoadmap, selectWorkspace, signIn, type Account,
} from "./planner-helpers";

/*
 * The forecast starts from today's sprint, so the browser clock is frozen on Friday, Oct 16 2026.
 * With the cadence on Sep 7 every sprint until Oct 18 holds one Barcelona holiday (Diada, La Mercè,
 * Hispanic Day): nine working days, 1.8 person-weeks per person. Oct 19 – Nov 1 has ten (2.0).
 */
const TODAY = new Date("2026-10-16T12:00:00");

const velocity = (page: Page) => page.getByRole("region", { name: "Squad velocity", exact: true });
/** The chart's screen-reader table: a header row, then one row per sprint start. */
async function velocityTable(page: Page) {
  return velocity(page).locator("table").evaluate(table =>
    Array.from(table.querySelectorAll("tr"), row => Array.from(row.children).map(cell => cell.textContent)));
}
async function barSeriesX(page: Page) {
  return velocity(page).locator(".recharts-bar").evaluateAll(series => series.map(bars =>
    bars.querySelector(".recharts-bar-rectangle path")?.getAttribute("x") ?? null));
}
async function toggleOption(page: Page, selector: string, option: string) {
  await velocity(page).getByRole("button", { name: selector, exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: option, exact: true }).click();
  await page.keyboard.press("Escape");
}

test.describe("Planner squad velocity", () => {
  let owner: Account;
  let context: BrowserContext | undefined;
  let page: Page;
  let workspace: { id: string; name: string };
  let teams: string[];
  const cleanup: (() => Promise<unknown>)[] = [];
  test.beforeEach(async ({ browser }) => {
    owner = await signIn();
    const suffix = randomUUID().slice(0, 8);
    teams = [`Alpha ${suffix}`, `Beta ${suffix}`];
    const alpha = await createRoster(owner, teams[0]!, [
      { name: "Ada", planning_role: "backend" },
      { name: "Fran", planning_role: "frontend" },
    ]);
    cleanup.push(() => removeRoster(owner, alpha.team.id));
    const beta = await createRoster(owner, teams[1]!, [{ name: "Dana", planning_role: "design" }]);
    cleanup.push(() => removeRoster(owner, beta.team.id));
    workspace = await seedRoadmap(owner, alpha.team.id, []);
    cleanup.push(() => api(owner, `workspaces?id=eq.${workspace.id}`, { method: "DELETE" }));
    await api(owner, "rpc/planner_set_workspace_teams", {
      method: "POST", body: JSON.stringify({ workspace: workspace.id, team_ids: [alpha.team.id, beta.team.id] }),
    });
    await api(owner, `workspaces?id=eq.${workspace.id}`, {
      method: "PATCH", body: JSON.stringify({ sprint_start_date: "2026-09-07" }),
    });
    ({ context, page } = await authenticatedPage(browser, owner));
    await page.clock.setFixedTime(TODAY);
    await page.reload();
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await expect(velocity(page)).toBeVisible();
  });
  test.afterEach(async () => {
    await context?.close();
    context = undefined;
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  test("groups capacity by area or team, stacking several series and showing one alone", async () => {
    await expect(velocity(page)).toContainText("Two-week sprints · Oct 5 to Jan 24");
    await expect(velocity(page)).toContainText("Available person-weeks per sprint");
    await expect(velocity(page)).toContainText("Calibrate with delivered sprint points");
    const grouping = velocity(page).getByLabel("Velocity grouping", { exact: true });
    await expect(grouping).toHaveValue("areas");
    await expect(velocity(page).getByRole("button", { name: "Select velocity areas", exact: true })).toHaveText("All areas");
    await expect.poll(async () => (await velocityTable(page)).slice(0, 3)).toEqual([
      ["Sprint starts", "Backend", "Frontend", "Design", "QA"],
      ["2026-10-05", "1.8", "1.8", "1.8", "0"],
      ["2026-10-19", "2", "2", "2", "0"],
    ]);
    await expect(velocity(page).getByRole("list", { name: "Velocity legend" })).toHaveText("BackendFrontendDesignQA");
    // Several series share one column per sprint: they are stacked, not side by side.
    await expect.poll(async () => {
      const [backend, frontend] = await barSeriesX(page);
      return backend !== null && backend === frontend;
    }).toBe(true);

    await toggleOption(page, "Select velocity areas", "Frontend");
    await toggleOption(page, "Select velocity areas", "Design");
    await toggleOption(page, "Select velocity areas", "QA");
    await expect(velocity(page).getByRole("button", { name: "Select velocity areas", exact: true })).toHaveText("Backend");
    await expect(velocity(page).getByRole("list", { name: "Velocity legend" })).toHaveText("Backend");
    await expect.poll(async () => (await barSeriesX(page)).length).toBe(1);
    await toggleOption(page, "Select velocity areas", "Backend");
    await expect(velocity(page).getByRole("status")).toHaveText("Select at least one area or team to show velocity.");
    await toggleOption(page, "Select velocity areas", "All areas");
    await expect(velocity(page).getByRole("button", { name: "Select velocity areas", exact: true })).toHaveText("All areas");

    // Switching the grouping swaps the second selector to teams.
    await grouping.selectOption("teams");
    const teamSelector = velocity(page).getByRole("button", { name: "Select velocity teams", exact: true });
    await expect(teamSelector).toHaveText("All teams");
    await expect(velocity(page).getByRole("button", { name: "Select velocity areas", exact: true })).toHaveCount(0);
    await expect.poll(async () => (await velocityTable(page)).slice(0, 2)).toEqual([
      ["Sprint starts", ...teams],
      ["2026-10-05", "3.6", "1.8"],
    ]);
    await toggleOption(page, "Select velocity teams", teams[0]!);
    await expect(teamSelector).toHaveText(teams[1]!);
    await expect(velocity(page).getByRole("list", { name: "Velocity legend" })).toHaveText(teams[1]!);
  });

  test("calibration turns delivered sprint points into a saved story-point forecast", async () => {
    await velocity(page).getByRole("button", { name: "Calibrate velocity", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Calibrate squad velocity" });
    await expect(dialog.getByLabel("Sprint cadence starts", { exact: true })).toHaveValue("2026-09-07");

    // New rows default to the latest finished sprint, then step back one cadence at a time.
    await dialog.getByRole("button", { name: "Add sprint", exact: true }).click();
    await expect(dialog.getByLabel("Sprint start", { exact: true })).toHaveValue("2026-09-21");
    await dialog.getByLabel("Delivered story points", { exact: true }).fill("54");
    await expect(dialog).toContainText("Available person-weeks: 5.4");
    await expect(dialog).toContainText("10 story points per available person-week");
    await dialog.getByRole("button", { name: "Add sprint", exact: true }).click();
    await expect(dialog.getByLabel("Sprint start", { exact: true }).nth(1)).toHaveValue("2026-09-07");
    await dialog.getByLabel("Delivered story points", { exact: true }).nth(1).fill("27");
    await expect(dialog).toContainText("7.5 story points per available person-week");

    // Only finished sprints on the cadence count.
    const save = dialog.getByRole("button", { name: "Save calibration", exact: true });
    await dialog.getByLabel("Sprint start", { exact: true }).nth(1).fill("2026-09-14");
    await expect(dialog.getByRole("alert")).toHaveText("Sprint dates must follow the selected start date every 14 days.");
    await expect(save).toBeDisabled();
    await dialog.getByLabel("Sprint start", { exact: true }).nth(1).fill("2026-10-05");
    await expect(dialog.getByRole("alert")).toHaveText("Only completed sprints can be used for calibration.");
    await dialog.getByLabel("Sprint start", { exact: true }).nth(1).fill("2026-09-07");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog).toBeHidden();

    const forecast = [
      ["Sprint starts", "Backend", "Frontend", "Design", "QA"],
      ["2026-10-05", "13.5", "13.5", "13.5", "0"],
      ["2026-10-19", "15", "15", "15", "0"],
    ];
    await expect(velocity(page)).toContainText("Estimated story points per sprint");
    await expect.poll(async () => (await velocityTable(page)).slice(0, 3)).toEqual(forecast);
    expect(await api(owner, `workspaces?id=eq.${workspace.id}&select=sprint_start_date,sprint_history`)).toEqual([{
      sprint_start_date: "2026-09-07",
      sprint_history: [{ start_date: "2026-09-07", story_points: 27 }, { start_date: "2026-09-21", story_points: 54 }],
    }]);

    await page.reload();
    await selectWorkspace(page, workspace.name);
    await expect.poll(async () => (await velocityTable(page)).slice(0, 3)).toEqual(forecast);
    await velocity(page).getByRole("button", { name: "Calibrate velocity", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove sprint 1", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("10 story points per available person-week");
  });
});
