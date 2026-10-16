import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  addFeatures, api, authenticatedPage, createRoster, removeRoster, roadmapRowAction, seedRoadmap, selectWorkspace,
  setPlanStart, signIn, type Account,
} from "./planner-helpers";

async function openRoadmap(page: Page, workspaceName: string, start: string) {
  await selectWorkspace(page, workspaceName);
  await page.getByRole("link", { name: "Roadmap", exact: true }).click();
  await setPlanStart(page, start);
}
const span = (page: Page, label: string) => page.getByRole("group", { name: label, exact: true });
/** Every continuous run a role works on a feature is one bar; returns them all. */
const roleRuns = (page: Page, feature: string, role: string) =>
  page.getByRole("img", { name: new RegExp(`^${feature} · ${role}: `) });
async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) throw new Error("Element has no layout box");
  return result;
}
async function rowOrder(page: Page) {
  return page.locator('[aria-label^="Schedule row: "]').evaluateAll(rows =>
    rows.map(row => row.getAttribute("aria-label")!.replace("Schedule row: ", "")));
}

test.describe("Planner roadmap", () => {
  let owner: Account;
  let context: BrowserContext | undefined;
  const cleanup: (() => Promise<unknown>)[] = [];
  test.beforeEach(async () => { owner = await signIn(); });
  test.afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
    await context?.close();
  });

  test("two backends and one frontend share the roadmap without idle overlap", async ({ browser }) => {
    test.setTimeout(90_000);
    const roster = await createRoster(owner, `Roadmap squad ${randomUUID().slice(0, 8)}`, [
      { name: "Back", planning_role: "backend" },
      { name: "Back 2", planning_role: "backend" },
      { name: "Front", planning_role: "frontend" },
      { name: "Designer", planning_role: "design" },
      { name: "Quality", planning_role: "qa" },
    ]);
    cleanup.push(() => removeRoster(owner, roster.team.id));
    const workspace = await seedRoadmap(owner, roster.team.id, []);
    cleanup.push(() => api(owner, `planner_workspaces?id=eq.${workspace.id}`, { method: "DELETE" }));
    await addFeatures(owner, workspace.id, [
      { name: "Back Task", backend_devs: 2, backend_weeks: 2 },
      { name: "1 Back Task Second", backend_devs: 1, backend_weeks: 2 },
      { name: "1 Back Task", backend_devs: 1, backend_weeks: 2 },
      { name: "Mixed Project", backend_devs: 2, backend_weeks: 2, frontend_devs: 1, frontend_weeks: 2 },
      { name: "Front", frontend_devs: 1, frontend_weeks: 2 },
      { name: "Polish", design_devs: 1, design_weeks: 1, qa_devs: 1, qa_weeks: 1 },
    ]);
    const opened = await authenticatedPage(browser, owner);
    context = opened.context;
    const page = opened.page;
    await openRoadmap(page, workspace.name, "2026-02-02");

    // Both backends take the first feature, then split over the two single-backend features.
    await expect(span(page, "Back Task: Feb 2, 2026 to Feb 13, 2026")).toBeVisible();
    await expect(span(page, "1 Back Task Second: Feb 16, 2026 to Feb 27, 2026")).toBeVisible();
    await expect(span(page, "1 Back Task: Feb 16, 2026 to Feb 27, 2026")).toBeVisible();
    // The frontend is free from day one, so Mixed starts its frontend work while the backends are busy,
    // pauses, and resumes when both backends are free. Front then takes the frontend after it.
    await expect(span(page, "Mixed Project: Feb 2, 2026 to Mar 13, 2026")).toBeVisible();
    await expect(span(page, "Front: Feb 16, 2026 to Feb 27, 2026")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Schedule · 6\/6 completed/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Roadmap finishes" })).toContainText("Mar 13, 2026");

    // A role working two weeks in a row is one connected bar, with the exact people and effort.
    await expect(roleRuns(page, "Back Task", "Backend")).toHaveCount(1);
    await expect(roleRuns(page, "Back Task", "Backend")).toHaveAccessibleName(
      "Back Task · Backend: Feb 2, 2026 to Feb 13, 2026 · 2 people requested · 4.0 person-weeks");
    const mixedBack = roleRuns(page, "Mixed Project", "Backend");
    const mixedFront = roleRuns(page, "Mixed Project", "Frontend");
    await expect(mixedBack).toHaveAccessibleName(
      "Mixed Project · Backend: Mar 2, 2026 to Mar 13, 2026 · 2 people requested · 4.0 person-weeks");
    await expect(mixedFront).toHaveAccessibleName(
      "Mixed Project · Frontend: Feb 2, 2026 to Feb 13, 2026 · 1 person requested · 2.0 person-weeks");

    // Backend is the top half and frontend the bottom half of the feature bar.
    const mixedBar = await box(span(page, "Mixed Project: Feb 2, 2026 to Mar 13, 2026"));
    const back = await box(mixedBack);
    const front = await box(mixedFront);
    expect(back.y).toBeCloseTo(mixedBar.y, 0);
    expect(back.height).toBeCloseTo(mixedBar.height / 2, 0);
    expect(front.y).toBeCloseTo(mixedBar.y + mixedBar.height / 2, 0);
    expect(front.height).toBeCloseTo(mixedBar.height / 2, 0);
    // The idle weeks in between stay as the gray feature bar: no role bar covers them.
    expect(front.x).toBeCloseTo(mixedBar.x, 0);
    expect(back.x + back.width).toBeCloseTo(mixedBar.x + mixedBar.width, 0);
    expect(back.x - (front.x + front.width)).toBeGreaterThan(mixedBar.width / 4);
    await expect(span(page, "Mixed Project: Feb 2, 2026 to Mar 13, 2026")).toHaveClass(/bg-slate-400/);

    // Design and QA fill the full height, and QA only starts after design is done.
    const design = await box(roleRuns(page, "Polish", "Design"));
    const qa = await box(roleRuns(page, "Polish", "QA"));
    const polishBar = await box(page.getByRole("group", { name: /^Polish: / }));
    expect(design.height).toBeCloseTo(polishBar.height, 0);
    expect(qa.height).toBeCloseTo(polishBar.height, 0);
    expect(qa.x).toBeGreaterThanOrEqual(design.x + design.width - 1);
  });

  test("rows reorder by drag and drop, are delivered from the context menu and group by main project", async ({ browser }) => {
    test.setTimeout(90_000);
    const roster = await createRoster(owner, `Roadmap order ${randomUUID().slice(0, 8)}`, [
      { name: "Back", planning_role: "backend" },
    ]);
    cleanup.push(() => removeRoster(owner, roster.team.id));
    const workspace = await seedRoadmap(owner, roster.team.id, []);
    cleanup.push(() => api(owner, `planner_workspaces?id=eq.${workspace.id}`, { method: "DELETE" }));
    const projects = await api<{ id: string; name: string }[]>(owner, "projects", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify(["Payments", "Search"].map(name => ({ workspace_id: workspace.id, name }))),
    });
    const projectId = (name: string) => projects!.find(project => project.name === name)!.id;
    await addFeatures(owner, workspace.id, [
      { name: "Checkout", backend_devs: 1, backend_weeks: 1, project_id: projectId("Payments") },
      { name: "Refunds", backend_devs: 1, backend_weeks: 1, project_id: projectId("Payments") },
      { name: "Indexing", backend_devs: 1, backend_weeks: 1, project_id: projectId("Search") },
    ]);
    const opened = await authenticatedPage(browser, owner);
    context = opened.context;
    const page = opened.page;
    await openRoadmap(page, workspace.name, "2026-02-02");
    const schedule = page.getByLabel("Feature schedule");

    // A group title appears every time the main project changes, in priority order.
    await expect(schedule.getByRole("heading", { level: 3 })).toHaveText(["Payments", "Search"]);
    await expect(schedule.getByRole("heading", { name: "Project: Payments" })).toBeVisible();
    await expect.poll(() => rowOrder(page)).toEqual(["Checkout", "Refunds", "Indexing"]);

    // Dragging the name moves the feature; its project then appears twice, split around Search.
    await page.getByRole("button", { name: "Reorder Indexing", exact: true })
      .dragTo(page.getByRole("button", { name: "Reorder Refunds", exact: true }));
    await expect.poll(() => rowOrder(page)).toEqual(["Checkout", "Indexing", "Refunds"]);
    await expect(schedule.getByRole("heading", { level: 3 })).toHaveText(["Payments", "Search", "Payments"]);
    await expect(span(page, "Indexing: Feb 9, 2026 to Feb 13, 2026")).toBeVisible();
    await page.reload();
    await selectWorkspace(page, workspace.name);
    await expect.poll(() => rowOrder(page)).toEqual(["Checkout", "Indexing", "Refunds"]);

    // Delivery is a context-menu action on the whole row, and it can be undone.
    await roadmapRowAction(page, "Checkout", "Mark delivered");
    await expect(page.getByRole("group", { name: /^Checkout: .* · Delivered$/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /^Checkout · / })).toHaveCount(0);
    await roadmapRowAction(page, "Checkout", "Undo delivery");
    await expect(page.getByRole("group", { name: /^Checkout: .* · Delivered$/ })).toHaveCount(0);
    await expect(page.getByRole("group", { name: /^Checkout: / })).toBeVisible();
    // The schedule no longer offers reorder or delete buttons outside the rows themselves.
    await expect(page.getByRole("button", { name: /^(Move|Remove|Delete) / })).toHaveCount(0);
  });
});
