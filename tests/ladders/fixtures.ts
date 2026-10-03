import {
  test as base,
  expect,
  type Browser,
  type Page,
} from "@playwright/test";
import { LaddersData } from "../../scripts/ladders-data";
import { SECOND_STATE_PATH } from "../../scripts/ladders-auth";
import { projectConfigs } from "../../playwright.config";
import { LaddersApp } from "./ladders-app";

/**
 * Ladders fixtures.
 *
 * Data is seeded straight through PostgREST rather than the UI: it is much
 * faster, deterministic, and keeps the suites focused on the behaviour under
 * test. Anything created through the `data` helper is removed afterwards.
 */

/**
 * Timeouts.
 *
 * The default in playwright.config.ts is 5s, which is plenty for assertions on
 * an already rendered screen. The flows below have to reach Supabase and wait
 * for a reload before they can be observed, so they get a longer budget without
 * drifting anywhere near the 15-20s this suite used to sit on.
 */
export const DATA_TIMEOUT = 8_000;

export type Seeded = {
  member: Awaited<ReturnType<LaddersData["createMember"]>>;
  team: Awaited<ReturnType<LaddersData["createTeam"]>>;
};

/**
 * A second, signed out browser session.
 *
 * Shared evaluation links are opened by reviewers who have never signed in, so
 * they are exercised in their own context instead of the authenticated one. It
 * is also the only way to prove EntryGate really lets those routes through.
 */
export type SharedSession = {
  page: Page;
  app: LaddersApp;
  open: (path: string) => Promise<void>;
};

/**
 * The other side of a shared team.
 *
 * Signed in as the second test account, so sharing is proved between two real
 * users rather than by calling the API as the owner. Only usable once that
 * account can sign in; the sharing suite skips otherwise.
 */
export type CollaboratorSession = SharedSession;

export const test = base.extend<{
  data: LaddersData;
  defaultTeamName: string;
  shared: SharedSession;
  collaborator: CollaboratorSession;
}>({
  data: async ({}, use) => {
    const data = new LaddersData();
    await use(data);
    await data.cleanup().catch(() => undefined);
  },

  defaultTeamName: async ({ data }, use) => {
    const teams = await data.listTeams();
    const team = teams.find((t) => t.is_default) ?? teams[0];
    await use(team?.name ?? "");
  },

  shared: async ({ browser }, use) => {
    const context = await browser.newContext({
      baseURL: projectConfigs.ladders.localhost,
    });
    const page = await context.newPage();
    const app = new LaddersApp(page);
    await use({
      page,
      app,
      open: async (path: string) => {
        // A hash only change to the very same URL is a same document
        // navigation, so the page would keep the state from the last visit.
        // Reloading keeps "open the link again" meaning what it says.
        const target = new URL(path, projectConfigs.ladders.localhost).href;
        if (page.url() === target) await page.reload();
        else await page.goto(path);
      },
    });
    await context.close();
  },

  collaborator: async ({ browser }, use) => {
    const context = await browser.newContext({
      baseURL: projectConfigs.ladders.localhost,
      storageState: SECOND_STATE_PATH,
    });
    const page = await context.newPage();
    const app = new LaddersApp(page);
    await use({
      page,
      app,
      open: async (path: string) => {
        const target = new URL(path, projectConfigs.ladders.localhost).href;
        if (page.url() === target) await page.reload();
        else await page.goto(path);
      },
    });
    await context.close();
  },
});

/** Seeds a member already attached to the default team, so it shows up in both tabs. */
export async function seedMember(
  data: LaddersData,
  name: string,
  role = "Seeded role",
) {
  const teams = await data.listTeams();
  const team = teams.find((t) => t.is_default) ?? teams[0];
  return data.createMember({ name, role, teamId: team?.id ?? null });
}

/** Seeds an extra team owned by the test user. */
export async function seedTeam(data: LaddersData, name: string) {
  return data.createTeam(name);
}

export { expect };
