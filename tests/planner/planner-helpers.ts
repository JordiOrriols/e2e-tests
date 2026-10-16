import { expect, type Browser, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const env = Object.fromEntries(readFileSync(resolve(import.meta.dirname, "../../../planner/.env"), "utf8")
  .split("\n").map(line => line.match(/^\s*(VITE_SUPABASE_\w+)\s*=\s*(.*?)\s*$/))
  .filter((match): match is RegExpMatchArray => !!match).map(match => [match[1], match[2]]));
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Planner Supabase environment is missing");

export interface Account { access_token: string; user: { id: string; email: string } }
export async function signIn(second = false): Promise<Account> {
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
export async function api<T>(account: Account, path: string, init: RequestInit = {}): Promise<T | undefined> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key!, Authorization: `Bearer ${account.access_token}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`Planner data request failed (${response.status}): ${await response.text()}`);
  const body = await response.text();
  return body ? JSON.parse(body) : undefined;
}
export async function authenticatedPage(browser: Browser, account: Account): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext();
  await context.addInitScript(({ storageKey, session }) => {
    localStorage.setItem(storageKey, JSON.stringify(session));
    // Start in English, but keep a language the test picked across reloads.
    if (!localStorage.getItem("i18nextLng")) localStorage.setItem("i18nextLng", "en");
  }, {
    storageKey: `sb-${new URL(url!).hostname.split(".")[0]}-auth-token`, session: account,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5176/#/");
  return { page, context };
}

export const PLANNER_URL = "http://127.0.0.1:5176";

export type RosterMember = { name: string; role?: string; planning_role: string };
const DEFAULT_ROSTER: RosterMember[] = [
  { name: "Owner", role: "Senior Engineer", planning_role: "backend" },
  { name: "Frontend", role: "Frontend Engineer", planning_role: "frontend" },
];

/** A Ladders team with members; the first member is returned as `ownerMember`. */
export async function createRoster(account: Account, name: string, people: RosterMember[] = DEFAULT_ROSTER) {
  const team = await api<{ id: string }>(account, "rpc/create_team", {
    method: "POST", body: JSON.stringify({ p_name: name }),
  });
  if (!team) throw new Error("Ladders team creation returned no row");
  try {
    const members = await api<{ id: string; vacation_token: string; self_token: string; peer_token: string; view_token: string }[]>(account, "members", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify(people.map(person => ({ team_id: team.id, role: "", ...person }))),
    });
    if (!members?.[0]) throw new Error("Ladders member creation returned no row");
    return { team, members, ownerMember: members[0] };
  } catch (error) {
    await removeRoster(account, team.id);
    throw error;
  }
}
export async function removeRoster(account: Account, team: string) {
  await api(account, `members?team_id=eq.${team}`, { method: "DELETE" });
  await api(account, `teams?id=eq.${team}`, { method: "DELETE" });
}

/** First loads hit the remote Supabase and can outlast the default expect timeout under load. */
export const DATA_TIMEOUT = 15_000;
export async function waitForWorkspace(page: Page) {
  await expect(page.getByRole("button", { name: "Workspace", exact: true })).toBeVisible({ timeout: DATA_TIMEOUT });
  await expect(page.getByRole("status").filter({ hasText: /^Loading/ })).toHaveCount(0, { timeout: DATA_TIMEOUT });
}
export async function selectWorkspace(page: Page, name: string) {
  await waitForWorkspace(page);
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await waitForWorkspace(page);
  await expect(page.getByRole("button", { name: "Workspace", exact: true })).toHaveAttribute("title", name);
}
export async function setPlanStart(page: Page, date: string) {
  const input = page.getByLabel("Plan starts", { exact: true }).and(page.locator("input"));
  if (!(await input.isVisible())) await page.getByRole("button", { name: "Edit plan start", exact: true }).click();
  await input.fill(date);
  // The editor closes once the plan start is saved; until then the schedule is read-only.
  await expect(input).toBeHidden();
}
/** The vacation calendar opens on the current month; page to the month of `date`. */
export async function showMonth(page: Page, date: string) {
  const target = new Date(`${date}T00:00:00`);
  const now = new Date();
  const offset = (target.getFullYear() - now.getFullYear()) * 12 + target.getMonth() - now.getMonth();
  const button = page.getByRole("button", { name: offset > 0 ? "Next month" : "Previous month", exact: true });
  for (let step = 0; step < Math.abs(offset); step++) await button.click();
}
export function calendarDay(page: Page, date: string) {
  return page.getByRole("button", { name: new RegExp(`^${date}( |$)`) });
}
export async function setAvailability(page: Page, from: string, to: string, action: "Vacations" | "Working Day") {
  await showMonth(page, from);
  await calendarDay(page, from).click();
  if (to !== from) await calendarDay(page, to).click();
  await page.getByRole("button", { name: action, exact: true }).click();
}
export function vacationBadge(page: Page, date: string, member: string) {
  return calendarDay(page, date).getByLabel(`${member}: vacation`, { exact: true });
}
export async function roadmapRowAction(page: Page, feature: string, action: string) {
  await page.getByLabel(`Schedule row: ${feature}`, { exact: true }).click({ button: "right", position: { x: 40, y: 12 } });
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

export type Feature = { name: string } & Partial<Record<
  "backend_devs" | "backend_weeks" | "frontend_devs" | "frontend_weeks" | "design_devs" | "design_weeks" | "qa_devs" | "qa_weeks"
  | "priority" | "main_project_id", number | string>> & { in_backlog?: boolean };

const ROLE_FIELDS = ["backend", "frontend", "design", "qa"].flatMap(role => [`${role}_devs`, `${role}_weeks`]);

/** A linked workspace whose roadmap holds `features` in the given priority order. */
export async function seedRoadmap(owner: Account, teamId: string, features: Feature[]) {
  const workspaceName = `Roadmap ${randomUUID().slice(0, 8)}`;
  const workspace = await api<{ id: string }>(owner, "rpc/planner_create_linked_workspace", {
    method: "POST", body: JSON.stringify({ workspace_name: workspaceName }),
  });
  if (!workspace) throw new Error("Workspace creation did not return a row");
  await api(owner, "rpc/planner_set_workspace_teams", {
    method: "POST", body: JSON.stringify({ workspace: workspace.id, team_ids: [teamId] }),
  });
  return { id: workspace.id, name: workspaceName };
}
export async function addFeatures(owner: Account, workspaceId: string, features: Feature[]) {
  await api(owner, "planner_projects", {
    method: "POST",
    body: JSON.stringify(features.map((feature, index) => ({
      // A bulk insert needs every row to carry the same columns.
      workspace_id: workspaceId, in_backlog: true, priority: index + 1, main_project_id: null,
      ...Object.fromEntries(ROLE_FIELDS.map(field => [field, 0])), ...feature,
    }))),
  });
}
