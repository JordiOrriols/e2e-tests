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
  await context.addInitScript(({ storageKey, session }) => localStorage.setItem(storageKey, JSON.stringify(session)), {
    storageKey: `sb-${new URL(url!).hostname.split(".")[0]}-auth-token`, session: account,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5176/#/");
  return { page, context };
}

test("estimates, priority scheduling, invitations and vacation ownership persist through Supabase", async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await signIn();
  const collaborator = await signIn(true);
  const { page, context } = await authenticatedPage(browser, owner);
  const workspaceName = `Planner E2E ${randomUUID().slice(0, 8)}`;
  let workspaceId: string | undefined;
  let secondContext: BrowserContext | undefined;
  try {
    await expect(page.getByRole("heading", { name: /Microproject estimation|Your planning workspace/ })).toBeVisible();
    if (await page.getByRole("button", { name: "New workspace" }).isVisible()) await page.getByRole("button", { name: "New workspace" }).click();
    await page.getByLabel("Workspace name").fill(workspaceName);
    await page.getByLabel("Your name", { exact: true }).fill("Owner");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Microproject estimation" })).toBeVisible();
    const workspaces = await api<{ id: string }[]>(owner, `planner_workspaces?name=eq.${encodeURIComponent(workspaceName)}&select=id`);
    workspaceId = workspaces?.[0]?.id;
    if (!workspaceId) throw new Error("Test workspace was not persisted");

    await page.getByRole("button", { name: "New microproject" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Checkout");
    await page.getByLabel("Backend people").fill("1");
    await page.getByLabel("Backend weeks").fill("1");
    await page.getByRole("button", { name: "Create microproject" }).click();
    await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add to backlog: Checkout", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove from backlog: Checkout" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Backlog Plan" }).click();
    await page.getByLabel("Plan starts").fill("2026-10-05");
    await expect(page.getByLabel("Project schedule")).toContainText("Oct 9, 2026");

    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await page.getByLabel("First day").fill("2026-10-05");
    await page.getByLabel("Last day").fill("2026-10-06");
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByText("2026-10-05 · Not working", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Backlog Plan" }).click();
    await page.getByLabel("Plan starts").fill("2026-10-05");
    await expect(page.getByLabel("Project schedule")).toContainText("Oct 14, 2026");

    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Teammate");
    await page.getByLabel("Email", { exact: true }).fill(collaborator.user.email);
    await page.getByLabel("Role", { exact: true }).selectOption("frontend");
    await page.getByRole("button", { name: "Invite member" }).click();
    await expect(page.getByText("Frontend · Invited")).toBeVisible();

    const second = await authenticatedPage(browser, collaborator);
    secondContext = second.context;
    await second.page.getByRole("button", { name: `Join ${workspaceName}`, exact: true }).click();
    await second.page.getByLabel("Workspace", { exact: true }).selectOption(workspaceId);
    await expect(second.page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
    await expect(second.page.getByRole("button", { name: "New microproject" })).toHaveCount(0);
    await second.page.getByRole("link", { name: "Vacations", exact: true }).click();
    await second.page.getByLabel("First day").fill("2026-10-07");
    await second.page.getByLabel("Last day").fill("2026-10-07");
    await second.page.getByRole("button", { name: "Save availability" }).click();
    await expect(second.page.getByText("2026-10-07 · Not working", { exact: true })).toBeVisible();
    await second.page.getByRole("button", { name: "Owner Backend · Joined" }).click();
    await expect(second.page.getByRole("button", { name: "Save availability" })).toHaveCount(0);

    const members = await api<{ id: string; user_id: string }[]>(owner, `planner_members?workspace_id=eq.${workspaceId}&select=id,user_id`);
    const ownerMember = members?.find(member => member.user_id === owner.user.id);
    if (!ownerMember) throw new Error("Workspace owner member was not persisted");
    const blocked = await fetch(`${url}/rest/v1/rpc/planner_set_availability`, {
      method: "POST", headers: { apikey: key!, Authorization: `Bearer ${collaborator.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ member: ownerMember.id, start_date: "2026-10-08", end_date: "2026-10-08", working: false }),
    });

    expect(blocked.ok).toBe(false);

    await page.getByRole("link", { name: "Estimation", exact: true }).click();
    await page.getByRole("button", { name: "Edit Checkout" }).click();
    await page.getByLabel("Backend weeks").fill("2");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("article")).toContainText("1×2w");
    await page.getByRole("button", { name: "Delete Checkout" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No microprojects yet" })).toBeVisible();
  } finally {
    if (!workspaceId) {
      const rows = await api<{ id: string }[]>(owner, `planner_workspaces?name=eq.${encodeURIComponent(workspaceName)}&select=id`);
      workspaceId = rows?.[0]?.id;
    }
    if (workspaceId) await api(owner, `planner_workspaces?id=eq.${workspaceId}`, { method: "DELETE" });
    await secondContext?.close();
    await context.close();
  }
});

test("backlog priorities can be reordered and different roles run in parallel", async ({ browser }) => {
  const owner = await signIn();
  const workspace = await api<{ id: string }>(owner, "rpc/planner_create_workspace", {
    method: "POST",
    body: JSON.stringify({ workspace_name: `Planner order ${randomUUID().slice(0, 8)}`, member_name: "Owner", member_role: "backend" }),
  });
  if (!workspace) throw new Error("Workspace creation did not return a row");
  let context: BrowserContext | undefined;
  try {
    await api(owner, "rpc/planner_invite_member", {
      method: "POST",
      body: JSON.stringify({ workspace: workspace.id, member_email: `${randomUUID()}@example.test`, member_name: "Frontend", member_role: "frontend" }),
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
    await page.getByLabel("Plan starts").fill("2026-10-05");
    await expect(page.getByLabel("Second: Oct 5, 2026 to Oct 9, 2026", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    await page.getByRole("button", { name: "Edit Owner", exact: true }).click();
    await page.getByLabel("Member role", { exact: true }).selectOption("design");
    await page.getByRole("button", { name: "Save member", exact: true }).click();
    await expect(page.getByText("Design · Joined")).toBeVisible();
    await page.getByRole("link", { name: "Backlog Plan", exact: true }).click();
    await expect(page.getByLabel("Project schedule")).toContainText("No Backend capacity");
  } finally {
    await api(owner, `planner_workspaces?id=eq.${workspace.id}`, { method: "DELETE" });
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
