import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  PLANNER_URL, api, authenticatedPage, calendarDay, createRoster, removeRoster, selectWorkspace, setAvailability,
  showMonth, signIn, vacationBadge, type Account,
} from "./planner-helpers";

type Row = { date: string; is_working: boolean };
const octoberRows = (owner: Account, member: string) => api<Row[]>(owner,
  `vacations?member_id=eq.${member}&date=gte.2026-10-01&date=lte.2026-10-31&select=date,is_working&order=date`);
const pressedDays = (page: Page) => page.locator('button[aria-pressed="true"]').evaluateAll(days =>
  days.map(day => day.getAttribute("aria-label")!.slice(0, 10)));
const days = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `2026-10-${String(from + index).padStart(2, "0")}`);

test.describe("Planner vacation calendar", () => {
  let owner: Account;
  let roster: Awaited<ReturnType<typeof createRoster>>;
  const contexts: BrowserContext[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  test.beforeEach(async () => {
    owner = await signIn();
    roster = await createRoster(owner, `Vacations ${randomUUID().slice(0, 8)}`);
    cleanup.push(() => removeRoster(owner, roster.team.id));
  });
  test.afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  test("a selected range stays on the calendar and Working Day only removes vacations", async ({ browser }) => {
    test.setTimeout(90_000);
    const workspaceName = `Vacations ${randomUUID().slice(0, 8)}`;
    const workspace = await api<{ id: string }>(owner, "rpc/planner_create_linked_workspace", {
      method: "POST", body: JSON.stringify({ workspace_name: workspaceName }),
    });
    cleanup.push(() => api(owner, `workspaces?id=eq.${workspace!.id}`, { method: "DELETE" }));
    await api(owner, "rpc/planner_set_workspace_teams", {
      method: "POST", body: JSON.stringify({ workspace: workspace!.id, team_ids: [roster.team.id] }),
    });
    // A day explicitly marked as worked (a working Saturday) must survive clearing the vacations around it.
    await api(owner, "vacations", {
      method: "POST", body: JSON.stringify({ member_id: roster.ownerMember.id, date: "2026-10-10", is_working: true }),
    });
    const opened = await authenticatedPage(browser, owner);
    contexts.push(opened.context);
    const page = opened.page;
    await selectWorkspace(page, workspaceName);
    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await page.getByLabel("Member", { exact: true }).selectOption(roster.ownerMember.id);

    // One click per action: no From/To inputs, no availability dropdown and no separate save button.
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: /availability|status/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
    const vacations = page.getByRole("button", { name: "Vacations", exact: true });
    const workingDay = page.getByRole("button", { name: "Working Day", exact: true });
    await expect(vacations).toBeDisabled();
    await expect(workingDay).toBeDisabled();

    // The first click marks the start, the second the end; the whole range stays highlighted.
    await showMonth(page, "2026-10-05");
    await calendarDay(page, "2026-10-05").click();
    await expect.poll(() => pressedDays(page)).toEqual(["2026-10-05"]);
    await expect(page.getByRole("status")).toContainText("Select the last day, or apply to this day.");
    await calendarDay(page, "2026-10-09").click();
    await expect.poll(() => pressedDays(page)).toEqual(days(5, 9));
    await expect(vacations).toBeEnabled();
    await vacations.click();
    await expect(vacationBadge(page, "2026-10-09", "Owner")).toBeVisible();
    await expect(vacationBadge(page, "2026-10-09", "Owner")).toContainText("O");
    // Applying keeps the selection on screen.
    await expect.poll(() => pressedDays(page)).toEqual(days(5, 9));
    await setAvailability(page, "2026-10-13", "2026-10-16", "Vacations");
    await expect(vacationBadge(page, "2026-10-16", "Owner")).toBeVisible();
    await expect.poll(() => octoberRows(owner, roster.ownerMember.id)).toEqual([
      ...days(5, 9).map(date => ({ date, is_working: false })),
      { date: "2026-10-10", is_working: true },
      ...days(13, 16).map(date => ({ date, is_working: false })),
    ]);

    // Clearing the whole span, weekend and Hispanic Day holiday included, deletes only the vacations.
    await setAvailability(page, "2026-10-05", "2026-10-16", "Working Day");
    await expect.poll(() => pressedDays(page)).toEqual(days(5, 16));
    for (const date of [...days(5, 9), ...days(13, 16)]) await expect(vacationBadge(page, date, "Owner")).toHaveCount(0);
    await expect.poll(() => octoberRows(owner, roster.ownerMember.id)).toEqual([{ date: "2026-10-10", is_working: true }]);
    await expect(calendarDay(page, "2026-10-12")).toHaveAccessibleName(/^2026-10-12 .+/);

    await page.getByRole("button", { name: "Clear selection", exact: true }).click();
    await expect.poll(() => pressedDays(page)).toEqual([]);
    await expect(vacations).toBeDisabled();
  });

  test("a personal vacation link shows the teammates' vacations with a legend and initials", async ({ browser }) => {
    const teammate = roster.members[1]!;
    await api(owner, "rpc/planner_set_vacations", {
      method: "POST",
      body: JSON.stringify({ member: teammate.id, start_date: "2026-10-07", end_date: "2026-10-07", working: false }),
    });
    const anonymous = await browser.newContext();
    contexts.push(anonymous);
    const page = await anonymous.newPage();
    await page.goto(`${PLANNER_URL}/#/vacations/${roster.ownerMember.vacation_token}`);
    await expect(page.getByRole("heading", { name: "Owner", exact: true })).toBeVisible();
    await expect(page.locator('input[type="date"]')).toHaveCount(0);

    const legend = page.getByLabel("Team vacation legend", { exact: true });
    await expect(legend).toContainText("OOwner (you / selected)");
    await expect(legend).toContainText("FFrontend");
    await showMonth(page, "2026-10-07");
    await expect(vacationBadge(page, "2026-10-07", "Frontend")).toBeVisible();
    await expect(vacationBadge(page, "2026-10-07", "Frontend")).toContainText("F");

    // The link edits only its own member: the teammate's day stays when the owner marks theirs.
    await setAvailability(page, "2026-10-07", "2026-10-08", "Vacations");
    await expect(vacationBadge(page, "2026-10-08", "Owner")).toBeVisible();
    await expect(vacationBadge(page, "2026-10-07", "Owner")).toBeVisible();
    await setAvailability(page, "2026-10-07", "2026-10-07", "Working Day");
    await expect(vacationBadge(page, "2026-10-07", "Owner")).toHaveCount(0);
    await expect(vacationBadge(page, "2026-10-07", "Frontend")).toBeVisible();
    expect(await octoberRows(owner, teammate.id)).toEqual([{ date: "2026-10-07", is_working: false }]);
    expect(await octoberRows(owner, roster.ownerMember.id)).toEqual([{ date: "2026-10-08", is_working: false }]);
  });
});
