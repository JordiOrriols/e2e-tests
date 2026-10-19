import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectConfigs } from "../../playwright.config";
import type { Account } from "../planner/planner-helpers";

export { api, createWorkspace, removeWorkspace, signIn, type Account } from "../planner/planner-helpers";

export const PULSE_URL = projectConfigs.pulse.localhost;

const supabaseUrl = readFileSync(resolve(import.meta.dirname, "../../../pulse/.env"), "utf8")
  .match(/^\s*VITE_SUPABASE_URL\s*=\s*(.*?)\s*$/m)?.[1];
if (!supabaseUrl) throw new Error("Pulse Supabase environment is missing");
const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;

/** Opens Pulse in English, signed in as `account` when given. */
export async function openPulse(browser: Browser, account?: Account): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext();
  await context.addInitScript(({ key, session }) => {
    if (session) localStorage.setItem(key, JSON.stringify(session));
    if (!localStorage.getItem("i18nextLng")) localStorage.setItem("i18nextLng", "en");
  }, { key: storageKey, session: account ?? null });
  const page = await context.newPage();
  await page.goto(`${PULSE_URL}/#/`);
  return { page, context };
}

export const workspaceButton = (page: Page) => page.getByRole("button", { name: "Workspace", exact: true });

export async function selectWorkspace(page: Page, name: string) {
  await expect(workspaceButton(page)).toBeVisible({ timeout: 15_000 });
  await expect(workspaceButton(page)).toHaveAttribute("title", /.+/, { timeout: 15_000 });
  await workspaceButton(page).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await expect(workspaceButton(page)).toHaveAttribute("title", name);
}
