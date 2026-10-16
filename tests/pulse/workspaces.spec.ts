import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  api, createWorkspace, openPulse, removeWorkspace, selectWorkspace, signIn, workspaceButton, type Account,
} from "./pulse-helpers";

test.describe("Pulse sign-in and workspaces", () => {
  const contexts: BrowserContext[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  test.afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    for (const step of cleanup.splice(0).reverse()) await step();
  });
  async function open(browser: Parameters<typeof openPulse>[0], account?: Account) {
    const opened = await openPulse(browser, account);
    contexts.push(opened.context);
    return opened.page;
  }

  test("signed-out visitors see the welcome page with sign-in and sign-up", async ({ browser }) => {
    const page = await open(browser);
    await expect(page.getByRole("heading", { name: "Keep a finger on the team's pulse." })).toBeVisible();
    await page.getByRole("button", { name: "Sign in" }).click();
    const signInDialog = page.getByRole("alertdialog", { name: "Sign in" });
    await expect(signInDialog.getByLabel("Email")).toBeVisible();
    await expect(signInDialog.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
    await signInDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(signInDialog).toBeHidden();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("alertdialog", { name: "Create an account" })).toBeVisible();
  });

  test("signs out back to the welcome page", async ({ browser }) => {
    const page = await open(browser, await signIn());
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Keep a finger on the team's pulse." })).toBeVisible();
  });

  test("creates a workspace from the workspace bar and opens it", async ({ browser }) => {
    const owner = await signIn();
    const name = `Pulse ${randomUUID().slice(0, 8)}`;
    cleanup.push(async () => {
      const rows = await api<{ id: string }[]>(owner, `workspaces?name=eq.${encodeURIComponent(name)}&select=id`);
      for (const row of rows ?? []) await removeWorkspace(owner, row.id);
    });
    const page = await open(browser, owner);
    await expect(workspaceButton(page)).toBeVisible({ timeout: 15_000 });
    await workspaceButton(page).click();
    await page.getByRole("menuitem", { name: "New workspace" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(workspaceButton(page)).toHaveAttribute("title", name);
    await expect(workspaceButton(page)).toContainText("Owner");
    await expect(page.getByRole("main").getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    await page.reload();
    await expect(workspaceButton(page)).toHaveAttribute("title", name, { timeout: 15_000 });
  });

  test("a Pulse share opens the workspace for the other account, a Planner share does not", async ({ browser }) => {
    const owner = await signIn();
    const other = await signIn(true);
    const workspace = await createWorkspace(owner, `Pulse ${randomUUID().slice(0, 8)}`);
    cleanup.push(() => removeWorkspace(owner, workspace.id));

    const ownerPage = await open(browser, owner);
    await selectWorkspace(ownerPage, workspace.name);
    await ownerPage.getByTestId("workspace-share").click();
    const dialog = ownerPage.getByRole("alertdialog", { name: `Share ${workspace.name}` });
    await dialog.getByLabel("Email").fill(other.user.email);
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(dialog.getByText(other.user.email)).toBeVisible();
    await expect.poll(async () => (await api<{ app: string }[]>(owner, "rpc/list_workspace_shares", {
      method: "POST", body: JSON.stringify({ workspace: workspace.id }),
    }))?.map(share => share.app)).toEqual(["pulse"]);

    const otherPage = await open(browser, other);
    await selectWorkspace(otherPage, workspace.name);
    await expect(workspaceButton(otherPage)).toContainText("Viewer");
    await expect(otherPage.getByTestId("workspace-share")).toHaveCount(0);

    await api(owner, "rpc/remove_workspace_share", {
      method: "POST", body: JSON.stringify({ workspace: workspace.id, account: other.user.id, app_name: "pulse" }),
    });
    await api(owner, "rpc/share_workspace", {
      method: "POST",
      body: JSON.stringify({ workspace: workspace.id, account_email: other.user.email, app_name: "planner", access: "viewer" }),
    });
    await otherPage.reload();
    await expect(workspaceButton(otherPage)).toBeVisible({ timeout: 15_000 });
    await workspaceButton(otherPage).click();
    await expect(otherPage.getByRole("menuitemradio", { name: workspace.name, exact: true })).toHaveCount(0);
  });
});
