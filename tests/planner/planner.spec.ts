import { test, expect, type Browser, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(readFileSync(resolve(import.meta.dirname, "../../../planner/.env"), "utf8")
  .split("\n").map(line => line.match(/^\s*(VITE_SUPABASE_\w+)\s*=\s*(.*?)\s*$/))
  .filter((match): match is RegExpMatchArray => !!match).map(match => [match[1], match[2]]));
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Planner Supabase environment is missing");

interface Account { access_token: string; user: { id: string; email: string } }
async function signIn(second = false): Promise<Account> {
  const email = process.env[second ? "LADDERS_TEST2_EMAIL" : "LADDERS_TEST_EMAIL"];
  const password = process.env[second ? "LADDERS_TEST2_PASSWORD" : "LADDERS_TEST_PASSWORD"];
  if (!email || !password) throw new Error("Configure both Ladders test accounts to verify Planner collaboration");
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: key!, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Planner test authentication failed (${response.status})`);
  return response.json();
}
async function api<T>(account: Account, path: string, init: RequestInit = {}): Promise<T | undefined> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key!, Authorization: `Bearer ${account.access_token}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`Planner data request failed (${response.status}): ${await response.text()}`);
  const body = await response.text();
  return body ? JSON.parse(body) : undefined;
}
async function authenticatedPage(browser: Browser, account: Account): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext();
  await context.addInitScript(({ storageKey, session }) => {
    localStorage.setItem(storageKey, JSON.stringify(session));
    localStorage.setItem("i18nextLng", "en");
  }, {
    storageKey: `sb-${new URL(url!).hostname.split(".")[0]}-auth-token`, session: account,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5176/#/");
  return { page, context };
}

async function createRoster(account: Account, name: string) {
  const team = await api<{ id: string }>(account, "rpc/create_team", {
    method: "POST", body: JSON.stringify({ p_name: name }),
  });
  if (!team) throw new Error("Ladders team creation returned no row");
  try {
    const members = await api<{ id: string; vacation_token: string; self_token: string; peer_token: string; view_token: string }[]>(account, "members", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify([
        { team_id: team.id, name: "Owner", role: "Senior Engineer", planning_role: "backend" },
        { team_id: team.id, name: "Frontend", role: "Frontend Engineer", planning_role: "frontend" },
      ]),
    });
    if (!members?.[0]) throw new Error("Ladders member creation returned no row");
    return { team, members, ownerMember: members[0] };
  } catch (error) {
    await removeRoster(account, team.id);
    throw error;
  }
}
async function removeRoster(account: Account, team: string) {
  await api(account, `members?team_id=eq.${team}`, { method: "DELETE" });
  await api(account, `teams?id=eq.${team}`, { method: "DELETE" });
}

test("estimates, priority scheduling, linked Ladders teams and token vacations persist through Supabase", async ({ browser }) => {
  test.setTimeout(90_000);
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
  const roster = await createRoster(owner, workspaceName);
  let workspaceId: string | undefined;
  let secondContext: BrowserContext | undefined;
  try {
    await expect(page.getByRole("heading", { name: /Microproject estimation|Your planning workspace/ })).toBeVisible();
    if (await page.getByRole("button", { name: "New workspace" }).isVisible()) await page.getByRole("button", { name: "New workspace" }).click();
    await page.getByLabel("Workspace name").fill(workspaceName);
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Microproject estimation" })).toBeVisible();
    const workspaces = await api<{ id: string }[]>(owner, `planner_workspaces?name=eq.${encodeURIComponent(workspaceName)}&select=id`);
    workspaceId = workspaces?.[0]?.id;
    if (!workspaceId) throw new Error("Test workspace was not persisted");
    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await page.getByRole("checkbox", { name: workspaceName, exact: true }).check();
    await page.getByRole("button", { name: "Save linked teams" }).click();
    await expect(page.getByLabel("Planning role for Owner")).toHaveValue("backend");
    await page.getByRole("link", { name: "Estimation", exact: true }).click();

    await expect(api(owner, "planner_projects", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceId, name: "Rejected fractional estimate",
        backend_devs: 1, backend_weeks: 1.5,
      }),
    })).rejects.toThrow(/planner_projects_whole_estimates/);

    await expect(page.getByTestId("header-title")).toHaveText("Cadence");
    await expect(page.getByTestId("header-title")).toHaveCSS("font-size", "18px");
    await expect(page.getByTestId("header-subtitle")).toHaveCSS("font-size", "12px");
    await expect(page.getByTestId("header-content").locator("svg")).toHaveCSS("width", "20px");
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Español" }).click();
    await expect(page.getByRole("link", { name: "Plan del backlog" })).toBeVisible();
    await expect(page.getByTestId("sign-out-button")).toHaveAccessibleName("Cerrar sesión");
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
    await page.getByRole("button", { name: "New microproject" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Checkout");
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
    await page.getByRole("button", { name: "Create microproject" }).click();
    await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Backlog Plan", exact: true }).click();
    await page.getByRole("button", { name: "Add projects", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Add to backlog: Checkout", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("All estimates are already in the backlog.");
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Remove from backlog: Checkout", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No projects in the backlog" })).toBeVisible();
    await page.getByRole("button", { name: "Add projects", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Add to backlog: Checkout", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("All estimates are already in the backlog.");
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page.getByLabel("Workspace", { exact: true }).selectOption(workspaceId);
    await expect.poll(async () => ({
      errors: runtimeErrors,
      selectedProjectVisible: await page.getByRole("button", { name: "Remove from backlog: Checkout", exact: true }).isVisible(),
    })).toEqual({ errors: [], selectedProjectVisible: true });
    await page.getByLabel("Plan starts").fill("2026-10-05");
    await expect(page.getByLabel("Project schedule")).toContainText("Oct 9, 2026");

    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await page.getByLabel("Member", { exact: true }).selectOption(roster.ownerMember.id);
    await page.getByLabel("From", { exact: true }).fill("2026-10-05");
    await page.getByLabel("To", { exact: true }).fill("2026-10-06");
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByText("2026-10-05: Not working", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Backlog Plan" }).click();
    await page.getByLabel("Plan starts").fill("2026-10-05");
    await expect(page.getByLabel("Project schedule")).toContainText("Oct 14, 2026");

    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await api(owner, "rpc/share_team_by_email", {
      method: "POST",
      body: JSON.stringify({ p_team_id: roster.team.id, p_email: collaborator.user.email, p_access: "viewer" }),
    });

    const second = await authenticatedPage(browser, collaborator);
    secondContext = second.context;
    await second.page.getByLabel("Workspace", { exact: true }).selectOption(workspaceId);
    await expect(second.page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
    await expect(second.page.getByRole("button", { name: "New microproject" })).toHaveCount(0);
    await second.page.getByRole("link", { name: "Vacations", exact: true }).click();
    await expect(second.page.getByRole("button", { name: "Save availability" })).toBeDisabled();
    await expect(second.page.getByLabel("Planning role for Owner")).toBeDisabled();
    await expect(second.page.getByRole("button", { name: /Copy vacation link/ })).toHaveCount(0);
    await expect(api(collaborator, "rpc/planner_set_team_availability", {
      method: "POST", body: JSON.stringify({ member: roster.ownerMember.id, start_date: "2026-10-08", end_date: "2026-10-08", working: false }),
    })).rejects.toThrow(/Team edit access/);

    const anonymous = await browser.newContext();
    try {
      const vacationPage = await anonymous.newPage();
      await vacationPage.goto(`http://127.0.0.1:5176/#/vacations/${roster.ownerMember.vacation_token}`);
      await expect(vacationPage.getByRole("heading", { name: "Owner", exact: true })).toBeVisible();
      await expect(vacationPage.getByLabel("Workspace", { exact: true })).toHaveCount(0);
      await vacationPage.getByLabel("From", { exact: true }).fill("2026-10-07");
      await vacationPage.getByLabel("To", { exact: true }).fill("2026-10-07");
      await vacationPage.getByRole("button", { name: "Save availability" }).click();
      await expect(vacationPage.getByText("2026-10-07: Not working", { exact: true })).toBeVisible();
      await vacationPage.reload();
      await expect(vacationPage.getByText("2026-10-07: Not working", { exact: true })).toBeVisible();
      await vacationPage.getByRole("button", { name: "Restore calendar default for 2026-10-07", exact: true }).click();
      await expect(vacationPage.getByText("2026-10-07: Not working", { exact: true })).toHaveCount(0);
      await vacationPage.goto(`http://127.0.0.1:5176/#/vacations/${roster.ownerMember.self_token}`);
      await expect(vacationPage.getByRole("alert")).toContainText("Invalid vacation link");
    } finally { await anonymous.close(); }

    await page.getByRole("link", { name: "Estimation", exact: true }).click();
    await page.getByRole("button", { name: "Edit Checkout" }).click();
    await page.getByLabel("Backend weeks").fill("2");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("article")).toContainText("1×2w");
    await page.getByRole("button", { name: "Delete Checkout" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No microprojects yet" })).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  } finally {
    if (!workspaceId) {
      const rows = await api<{ id: string }[]>(owner, `planner_workspaces?name=eq.${encodeURIComponent(workspaceName)}&select=id`);
      workspaceId = rows?.[0]?.id;
    }
    if (workspaceId) await api(owner, `planner_workspaces?id=eq.${workspaceId}`, { method: "DELETE" });
    await removeRoster(owner, roster.team.id);
    await secondContext?.close();
    await context.close();
  }
});

test("backlog priorities can be reordered and different roles run in parallel", async ({ browser }) => {
  const owner = await signIn();
  const roster = await createRoster(owner, `Planner order team ${randomUUID().slice(0, 8)}`);
  const workspace = await api<{ id: string }>(owner, "rpc/planner_create_linked_workspace", {
    method: "POST",
    body: JSON.stringify({ workspace_name: `Planner order ${randomUUID().slice(0, 8)}` }),
  });
  if (!workspace) throw new Error("Workspace creation did not return a row");
  let context: BrowserContext | undefined;
  try {
    await api(owner, "rpc/planner_set_workspace_teams", {
      method: "POST",
      body: JSON.stringify({ workspace: workspace.id, team_ids: [roster.team.id] }),
    });
    await api(owner, "planner_projects", {
      method: "POST",
      body: JSON.stringify(["First", "Second"].map((name, index) => ({
        workspace_id: workspace.id, name, in_backlog: true, priority: index + 1, backend_devs: 1, backend_weeks: 1,
      }))),
    });
    await api(owner, "planner_projects", {
      method: "POST",
      body: JSON.stringify({ workspace_id: workspace.id, name: "Parallel frontend", in_backlog: true, priority: 3, frontend_devs: 1, frontend_weeks: 1 }),
    });
    const opened = await authenticatedPage(browser, owner);
    context = opened.context;
    const page = opened.page;
    await expect(page.getByLabel("Workspace", { exact: true })).toBeVisible();
    await page.getByLabel("Workspace", { exact: true }).selectOption(workspace.id);
    await page.getByRole("link", { name: "Backlog Plan", exact: true }).click();
    await page.getByLabel("Plan starts").fill("2026-10-05");
    await expect(page.getByLabel("First: Oct 5, 2026 to Oct 9, 2026", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Parallel frontend: Oct 5, 2026 to Oct 9, 2026", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Move Second up", exact: true }).click();
    await expect(page.getByLabel("Second: Oct 5, 2026 to Oct 9, 2026", { exact: true })).toBeVisible();
    await expect(page.getByLabel("First: Oct 13, 2026 to Oct 19, 2026", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByLabel("Workspace", { exact: true }).selectOption(workspace.id);
    await page.getByLabel("Plan starts").fill("2026-10-05");
    await expect(page.getByLabel("Second: Oct 5, 2026 to Oct 9, 2026", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await page.getByLabel("Planning role for Owner", { exact: true }).selectOption("design");
    await expect(page.getByLabel("Planning role for Owner", { exact: true })).toHaveValue("design");
    await page.getByRole("link", { name: "Backlog Plan", exact: true }).click();
    await expect(page.getByLabel("Project schedule")).toContainText("No Backend capacity");
  } finally {
    await api(owner, `planner_workspaces?id=eq.${workspace.id}`, { method: "DELETE" });
    await removeRoster(owner, roster.team.id);
    await context?.close();
  }
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

test("Ladders shares a personal vacation link and its leave updates two multi-team plans", async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await signIn();
  const suffix = randomUUID().slice(0, 8);
  const roster = await createRoster(owner, `Shared roster ${suffix}`);
  const workspaces: string[] = [];
  let extraTeam: string | undefined;
  let context: BrowserContext | undefined;
  let anonymous: BrowserContext | undefined;
  try {
    const extra = await api<{ id: string }>(owner, "rpc/create_team", {
      method: "POST", body: JSON.stringify({ p_name: `Design roster ${suffix}` }),
    });
    if (!extra) throw new Error("Second team creation returned no row");
    extraTeam = extra.id;
    await api(owner, "members", {
      method: "POST", body: JSON.stringify({ team_id: extra.id, name: "Grace", planning_role: "design" }),
    });
    for (const name of ["First plan", "Second plan"]) {
      const workspace = await api<{ id: string }>(owner, "rpc/planner_create_linked_workspace", {
        method: "POST", body: JSON.stringify({ workspace_name: `${name} ${suffix}` }),
      });
      if (!workspace) throw new Error("Shared plan creation returned no row");
      workspaces.push(workspace.id);
      await api(owner, "planner_projects", {
        method: "POST", body: JSON.stringify({
          workspace_id: workspace.id, name: "Shared checkout", in_backlog: true,
          backend_devs: 1, backend_weeks: 1,
        }),
      });
    }
    const opened = await authenticatedPage(browser, owner);
    context = opened.context;
    const page = opened.page;
    await page.getByLabel("Workspace", { exact: true }).selectOption(workspaces[0]!);
    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await page.getByRole("checkbox", { name: `Shared roster ${suffix}`, exact: true }).check();
    await page.getByRole("checkbox", { name: `Design roster ${suffix}`, exact: true }).check();
    await page.getByRole("button", { name: "Save linked teams", exact: true }).click();
    await expect(page.getByLabel("Planning role for Grace", { exact: true })).toHaveValue("design");
    await api(owner, "rpc/planner_set_workspace_teams", {
      method: "POST", body: JSON.stringify({ workspace: workspaces[1], team_ids: [roster.team.id, extra.id] }),
    });

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
    await vacationPage.getByLabel("From", { exact: true }).fill("2026-10-05");
    await vacationPage.getByLabel("To", { exact: true }).fill("2026-10-06");
    await vacationPage.getByRole("button", { name: "Save availability" }).click();
    await expect(vacationPage.getByText("2026-10-05: Not working", { exact: true })).toBeVisible();
    expect(await vacationPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(2);
    await page.reload();
    for (const workspace of workspaces) {
      await page.getByLabel("Workspace", { exact: true }).selectOption(workspace);
      await page.getByRole("link", { name: "Backlog Plan", exact: true }).click();
      await page.getByLabel("Plan starts").fill("2026-10-05");
      await expect(page.getByLabel("Shared checkout: Oct 7, 2026 to Oct 14, 2026", { exact: true })).toBeVisible();
    }
    const availability = await api<{ member_id: string; date: string }[]>(owner, `planner_team_availability?member_id=eq.${roster.ownerMember.id}&select=member_id,date`);
    expect(availability).toHaveLength(2);
  } finally {
    for (const workspace of workspaces) await api(owner, `planner_workspaces?id=eq.${workspace}`, { method: "DELETE" });
    if (extraTeam) await removeRoster(owner, extraTeam);
    await removeRoster(owner, roster.team.id);
    await anonymous?.close();
    await context?.close();
  }
});
