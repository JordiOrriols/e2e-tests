import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { expectNoAnalytics } from "../../utils";
import {
  addFeatures, api, authenticatedPage, calendarDay, createRoster, createWorkspace, ensureProject, removeWorkspace, roadmapRowAction, selectWorkspace,
  setAvailability, setPlanStart, showMonth, signIn, vacationBadge,
} from "./planner-helpers";


test("estimates, priority scheduling, workspace teams and token vacations persist through Supabase", async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await signIn();
  const collaborator = await signIn(true);
  const { page, context } = await authenticatedPage(browser, owner);
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && message.text().includes("cannot be given refs"))
      runtimeErrors.push(message.text());
  });
  const workspaceName = `Planner E2E ${randomUUID().slice(0, 8)}`;
  let roster!: Awaited<ReturnType<typeof createRoster>>;
  let workspaceId: string | undefined;
  let secondContext: BrowserContext | undefined;
  try {
    await expect(page.getByRole("heading", { name: /Feature estimation|Your planning workspace/ })).toBeVisible();
    if (await page.getByRole("button", { name: "Workspace", exact: true }).isVisible()) {
      // With workspaces already listed, the shared workspace menu opens its name dialog.
      await page.getByRole("button", { name: "Workspace", exact: true }).click();
      await page.getByRole("menuitem", { name: "New workspace" }).click();
      const create = page.getByRole("alertdialog", { name: "New workspace" });
      await create.getByLabel("Name", { exact: true }).fill(workspaceName);
      await create.getByRole("button", { name: "Create", exact: true }).click();
    } else {
      await page.getByLabel("Workspace name").fill(workspaceName);
      await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: "Feature estimation" })).toBeVisible();
    const workspaces = await api<{ id: string }[]>(owner, `workspaces?name=eq.${encodeURIComponent(workspaceName)}&created_for_team=is.false&select=id`);
    workspaceId = workspaces?.[0]?.id;
    if (!workspaceId) throw new Error("Test workspace was not persisted");
    roster = await createRoster(owner, workspaceName, undefined, workspaceId);
    await page.getByRole("link", { name: "Team configuration", exact: true }).click();
    // The owner adds a team straight into this workspace; adding it reloads the roster too.
    const teams = page.getByRole("region", { name: "Teams", exact: true });
    await expect(teams.getByRole("checkbox")).toHaveCount(0);
    await teams.getByRole("textbox", { name: "New team name" }).fill(`Platform ${workspaceName}`);
    await teams.getByRole("button", { name: "Add team", exact: true }).click();
    await expect(teams.getByText(`Platform ${workspaceName}`, { exact: true })).toBeVisible();
    await expect(teams.getByText(workspaceName, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Planning role for Owner")).toHaveValue("backend");
    await page.getByRole("link", { name: "Estimation", exact: true }).click();

    await expect(api(owner, "features", {
      method: "POST",
      body: JSON.stringify({
        project_id: await ensureProject(owner, workspaceId), name: "Rejected fractional estimate",
        backend_devs: 1, backend_weeks: 1.5,
      }),
    })).rejects.toThrow(/features_whole_estimates/);

    await expect(page.getByTestId("header-title")).toHaveText("Planner");
    await expect(page.getByTestId("header-title")).toHaveCSS("font-size", "18px");
    await expect(page.getByTestId("header-subtitle")).toHaveCSS("font-size", "12px");
    await expect(page.getByTestId("header-content").locator("svg")).toHaveCSS("width", "20px");
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Español" }).click();
    await expect(page.getByRole("link", { name: "Hoja de ruta" })).toBeVisible();
    await expect(page.getByTestId("sign-out-button")).toHaveAccessibleName("Cerrar sesión");
    for (const [language, roadmap, signOut] of [
      ["Français", "Feuille de route", "Se déconnecter"],
      ["Deutsch", "Roadmap", "Abmelden"],
      ["Italiano", "Roadmap", "Esci"],
    ]) {
      await page.getByTestId("language-selector").click();
      await page.getByRole("menuitemradio", { name: language }).click();
      await expect(page.getByRole("link", { name: roadmap })).toBeVisible();
      await expect(page.getByTestId("sign-out-button")).toHaveAccessibleName(signOut);
    }
    await page.getByTestId("language-selector").click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByTestId("language-selector")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    const brand = await page.getByTestId("header-content").boundingBox();
    const tabs = await page.getByRole("navigation", { name: "Planner pages" }).boundingBox();
    expect(brand).not.toBeNull();
    expect(tabs).not.toBeNull();
    expect(tabs!.y).toBeGreaterThanOrEqual(brand!.y + brand!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(2);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "New feature" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Checkout");
    // Every feature belongs to a project, which can be created from the form.
    await page.getByLabel("Project", { exact: true }).selectOption({ label: "+ New project" });
    await page.getByLabel("New project name", { exact: true }).fill("Launch");
    for (const role of ["Backend", "Frontend", "Design", "QA"]) {
      for (const field of ["people", "weeks"]) {
        const input = page.getByLabel(`${role} ${field}`, { exact: true });
        await expect(input).toHaveAttribute("step", "1");
        await input.fill("1.5");
        expect(await input.evaluate(element => (element as HTMLInputElement).validity.stepMismatch)).toBe(true);
        await input.fill("0");
      }
    }
    await page.getByLabel("Backend people").fill("1");
    await page.getByLabel("Backend weeks").fill("1");
    await page.getByRole("button", { name: "Create feature" }).click();
    await expect(page.getByRole("article", { name: "Checkout", exact: true }).getByRole("heading", { level: 3 })).toHaveText("LaunchCheckout");
    await page.getByRole("link", { name: "Roadmap", exact: true }).click();
    await page.getByRole("button", { name: "Add feature", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Add feature to roadmap: Checkout", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("All features are already on the roadmap.");
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await roadmapRowAction(page, "Checkout", "Remove from roadmap");
    await expect(page.getByRole("heading", { name: "No features on the roadmap" })).toBeVisible();
    await page.getByRole("button", { name: "Add feature", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Add feature to roadmap: Checkout", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("All features are already on the roadmap.");
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await selectWorkspace(page, workspaceName);
    await expect.poll(async () => ({
      errors: runtimeErrors,
      selectedFeatureVisible: await page.getByLabel("Schedule row: Checkout", { exact: true }).isVisible(),
    })).toEqual({ errors: [], selectedFeatureVisible: true });
    await setPlanStart(page, "2026-10-05");
    await expect(page.getByLabel("Checkout: Oct 5, 2026 to Oct 9, 2026", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await page.getByLabel("Member", { exact: true }).selectOption(roster.ownerMember.id);
    await setAvailability(page, "2026-10-05", "2026-10-06", "Vacations");
    await expect(vacationBadge(page, "2026-10-05", "Owner")).toBeVisible();
    await expect(vacationBadge(page, "2026-10-06", "Owner")).toBeVisible();
    await page.getByRole("link", { name: "Roadmap", exact: true }).click();
    // Oct 12 is a Barcelona holiday, so five working days after the leave end on Oct 14.
    await expect(page.getByLabel("Checkout: Oct 7, 2026 to Oct 14, 2026", { exact: true })).toBeVisible();

    await api(owner, "rpc/share_workspace", {
      method: "POST",
      body: JSON.stringify({ workspace: workspaceId, account_email: collaborator.user.email, app_name: "ladders", access: "viewer" }),
    });

    const second = await authenticatedPage(browser, collaborator);
    secondContext = second.context;
    await selectWorkspace(second.page, workspaceName);
    await expect(second.page.getByRole("article", { name: "Checkout", exact: true }).getByRole("heading", { level: 3 })).toHaveText("LaunchCheckout");
    await expect(second.page.getByRole("button", { name: "New feature" })).toHaveCount(0);
    await second.page.getByRole("link", { name: "Vacations", exact: true }).click();
    await showMonth(second.page, "2026-10-05");
    await expect(calendarDay(second.page, "2026-10-08")).toBeDisabled();
    await expect(second.page.getByRole("button", { name: "Vacations", exact: true })).toBeDisabled();
    // Team configuration is for editors only, so viewers do not get the tab at all.
    await expect(second.page.getByRole("link", { name: "Team configuration", exact: true })).toHaveCount(0);
    await expect(second.page.getByRole("button", { name: /Copy vacation link/ })).toHaveCount(0);
    await expect(api(collaborator, "rpc/planner_set_vacations", {
      method: "POST", body: JSON.stringify({ member: roster.ownerMember.id, start_date: "2026-10-08", end_date: "2026-10-08", working: false }),
    })).rejects.toThrow(/Team edit access/);

    const anonymous = await browser.newContext();
    try {
      const vacationPage = await anonymous.newPage();
      await vacationPage.goto(`http://127.0.0.1:5176/#/vacations/${roster.ownerMember.vacation_token}`);
      await expect(vacationPage.getByRole("heading", { name: "Owner", exact: true })).toBeVisible();
      await expect(vacationPage.getByLabel("Workspace", { exact: true })).toHaveCount(0);
      await setAvailability(vacationPage, "2026-10-07", "2026-10-07", "Vacations");
      await expect(vacationBadge(vacationPage, "2026-10-07", "Owner")).toBeVisible();
      await vacationPage.reload();
      await showMonth(vacationPage, "2026-10-07");
      await expect(vacationBadge(vacationPage, "2026-10-07", "Owner")).toBeVisible();
      await setAvailability(vacationPage, "2026-10-07", "2026-10-07", "Working Day");
      await expect(vacationBadge(vacationPage, "2026-10-07", "Owner")).toHaveCount(0);
      await expect(vacationBadge(vacationPage, "2026-10-05", "Owner")).toBeVisible();
      await vacationPage.goto(`http://127.0.0.1:5176/#/vacations/${roster.ownerMember.self_token}`);
      await expect(vacationPage.getByRole("alert")).toContainText("Invalid vacation link");
    } finally { await anonymous.close(); }

    await page.getByRole("link", { name: "Estimation", exact: true }).click();
    await page.getByRole("button", { name: "Edit Checkout" }).click();
    await page.getByLabel("Backend weeks").fill("2");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("article", { name: "Checkout" })).toContainText(/Duration\s*2\s*weeks/i);
    await page.getByRole("button", { name: "Delete Checkout" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No features yet" })).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  } finally {
    if (!workspaceId) {
      const rows = await api<{ id: string }[]>(owner, `workspaces?name=eq.${encodeURIComponent(workspaceName)}&created_for_team=is.false&select=id`);
      workspaceId = rows?.[0]?.id;
    }
    if (workspaceId) await removeWorkspace(owner, workspaceId);
    await secondContext?.close();
    await context.close();
  }
});

test("roadmap priorities can be reordered and different roles run in parallel", async ({ browser }) => {
  const owner = await signIn();
  const workspaceName = `Planner order ${randomUUID().slice(0, 8)}`;
  const workspace = await createWorkspace(owner, workspaceName);
  let context: BrowserContext | undefined;
  try {
    await createRoster(owner, `Planner order team ${randomUUID().slice(0, 8)}`, undefined, workspace.id);
    await addFeatures(owner, workspace.id, [
      { name: "First", backend_devs: 1, backend_weeks: 1 },
      { name: "Second", backend_devs: 1, backend_weeks: 1 },
      { name: "Parallel frontend", frontend_devs: 1, frontend_weeks: 1 },
    ]);
    const opened = await authenticatedPage(browser, owner);
    context = opened.context;
    const page = opened.page;
    await selectWorkspace(page, workspaceName);
    await page.getByRole("link", { name: "Roadmap", exact: true }).click();
    await setPlanStart(page, "2026-10-05");
    await expect(page.getByLabel("First: Oct 5, 2026 to Oct 9, 2026", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Parallel frontend: Oct 5, 2026 to Oct 9, 2026", { exact: true })).toBeVisible();
    const reorderSecond = page.getByRole("button", { name: "Reorder Second", exact: true });
    await expect(reorderSecond).toBeEnabled();
    await reorderSecond.press("ArrowUp");
    await expect(page.getByLabel("Second: Oct 5, 2026 to Oct 9, 2026", { exact: true })).toBeVisible();
    await expect(page.getByLabel("First: Oct 13, 2026 to Oct 19, 2026", { exact: true })).toBeVisible();
    await page.reload();
    await selectWorkspace(page, workspaceName);
    // Both the priority order and the plan start are saved on the workspace.
    await expect(page.getByLabel("Second: Oct 5, 2026 to Oct 9, 2026", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Team configuration", exact: true }).click();
    await page.getByLabel("Planning role for Owner", { exact: true }).selectOption("design");
    await expect(page.getByLabel("Planning role for Owner", { exact: true })).toHaveValue("design");
    await page.getByRole("link", { name: "Roadmap", exact: true }).click();
    await expect(page.getByLabel("Feature schedule")).toContainText("No Backend capacity");
  } finally {
    await removeWorkspace(owner, workspace.id);
    await context?.close();
  }
});

test("automated test runs do not report analytics", async ({ page }) => {
  await expectNoAnalytics(page, async () => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });
});

test("anonymous shared login exposes recovery and delegates it without sending real email", async ({ page }) => {
  let recoveries = 0;
  await page.route("**/auth/v1/recover*", async route => {
    recoveries++;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/#/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByText("Forgot password?", { exact: true }).click();
  await page.getByTestId("login-email").fill("planner-recovery@example.test");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-info")).toBeVisible();
  expect(recoveries).toBe(1);
});

test("Ladders shares a personal vacation link and its leave shapes the plan of the team's workspace", async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await signIn();
  const suffix = randomUUID().slice(0, 8);
  const workspace = await createWorkspace(owner, `Shared plan ${suffix}`);
  let context: BrowserContext | undefined;
  let anonymous: BrowserContext | undefined;
  try {
    const roster = await createRoster(owner, `Shared roster ${suffix}`, undefined, workspace.id);
    await createRoster(owner, `Design roster ${suffix}`, [{ name: "Grace", planning_role: "design" }], workspace.id);
    await addFeatures(owner, workspace.id, [{ name: "Shared checkout", backend_devs: 1, backend_weeks: 1 }]);
    const opened = await authenticatedPage(browser, owner);
    context = opened.context;
    const page = opened.page;
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Team configuration", exact: true }).click();
    const teams = page.getByRole("region", { name: "Teams", exact: true });
    await expect(teams.getByText(`Shared roster ${suffix}`, { exact: true })).toBeVisible();
    await expect(teams.getByText(`Design roster ${suffix}`, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Planning role for Grace", { exact: true })).toHaveValue("design");

    const laddersPage = await context.newPage();
    const laddersURL = new URL(process.env.LADDERS_LOCAL_URL ?? "http://localhost:5175");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: laddersURL.origin });
    laddersURL.hash = `/member/${roster.ownerMember.id}`;
    await laddersPage.goto(laddersURL.toString());
    await expect(laddersPage.getByTestId("assessment-planning-role")).toHaveValue("backend");
    await expect(laddersPage.getByTestId("assessment-role")).toHaveValue("Senior Engineer");
    await laddersPage.getByTestId("assessment-planning-role").selectOption("qa");
    await expect.poll(async () => {
      const members = await api<{ planning_role: string; role: string }[]>(owner, `members?id=eq.${roster.ownerMember.id}&select=planning_role,role`);
      return members?.[0];
    }).toEqual({ planning_role: "qa", role: "Senior Engineer" });
    await laddersPage.getByTestId("assessment-planning-role").selectOption("backend");
    await expect.poll(async () => {
      const members = await api<{ planning_role: string }[]>(owner, `members?id=eq.${roster.ownerMember.id}&select=planning_role`);
      return members?.[0]?.planning_role;
    }).toBe("backend");
    await laddersPage.getByTestId("split-menu-member_share_self").click();
    laddersPage.once("dialog", dialog => dialog.dismiss());
    await laddersPage.getByTestId("split-item-member_share_vacations").click();
    const vacationURL = await laddersPage.evaluate(() => navigator.clipboard.readText());
    expect(new URL(vacationURL).hash).toBe(`#/vacations/${roster.ownerMember.vacation_token}`);
    expect(new URL(vacationURL).origin).toBe("http://127.0.0.1:5176");

    anonymous = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const vacationPage = await anonymous.newPage();
    await vacationPage.goto(vacationURL);
    await expect(vacationPage.getByRole("heading", { name: "Owner", exact: true })).toBeVisible();
    await setAvailability(vacationPage, "2026-10-05", "2026-10-06", "Vacations");
    await expect(vacationBadge(vacationPage, "2026-10-05", "Owner")).toBeVisible();
    expect(await vacationPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(2);
    await page.reload();
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Roadmap", exact: true }).click();
    await setPlanStart(page, "2026-10-05");
    await expect(page.getByLabel("Shared checkout: Oct 7, 2026 to Oct 14, 2026", { exact: true })).toBeVisible();
    const availability = await api<{ member_id: string; date: string }[]>(owner, `vacations?member_id=eq.${roster.ownerMember.id}&select=member_id,date`);
    expect(availability).toHaveLength(2);
  } finally {
    await removeWorkspace(owner, workspace.id);
    await anonymous?.close();
    await context?.close();
  }
});
