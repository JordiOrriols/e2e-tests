import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  api, createWorkspace, openPulse, removeWorkspace, selectWorkspace, signIn, type Account,
} from "./pulse-helpers";

/** Boards refresh every few seconds, so cross-account checks wait past one poll. */
const LIVE = { timeout: 15_000 };

test.describe("Pulse retrospectives", () => {
  const contexts: BrowserContext[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  test.afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  async function openRetros(browser: Parameters<typeof openPulse>[0], account: Account, workspace: string) {
    const { page, context } = await openPulse(browser, account);
    contexts.push(context);
    await selectWorkspace(page, workspace);
    await page.getByRole("navigation", { name: "Pulse pages" }).getByRole("link", { name: "Retrospectives" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Retrospectives" })).toBeVisible();
    return page;
  }

  async function addTopic(page: Page, column: string, title: string) {
    await page.getByLabel(`New topic in ${column}`).fill(title);
    const section = page.getByRole("region", { name: column });
    await section.getByRole("button", { name: "Add", exact: true }).click();
    await expect(section.getByText(title)).toBeVisible();
  }

  const stage = (page: Page) =>
    page.getByRole("list", { name: "Retrospective stages" }).locator("[aria-current=step]");

  test("an owner facilitates while a viewer adds topics and votes", async ({ browser }) => {
    const owner = await signIn();
    const member = await signIn(true);
    const workspace = await createWorkspace(owner, `Pulse ${randomUUID().slice(0, 8)}`);
    cleanup.push(() => removeWorkspace(owner, workspace.id));
    await api(owner, "rpc/share_workspace", {
      method: "POST",
      body: JSON.stringify({ workspace: workspace.id, account_email: member.user.email, app_name: "pulse", access: "viewer" }),
    });
    const title = `Sprint ${randomUUID().slice(0, 4)}`;

    const ownerPage = await openRetros(browser, owner, workspace.name);
    await expect(ownerPage.getByText("No retrospectives yet")).toBeVisible();
    await ownerPage.getByRole("button", { name: "New retrospective" }).click();
    const dialog = ownerPage.getByRole("dialog", { name: "New retrospective" });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Votes per person").fill("2");
    await dialog.getByRole("button", { name: "Create retrospective" }).click();
    await expect(dialog).toBeHidden();
    await expect(ownerPage.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await ownerPage.getByRole("button", { name: "Start Collect" }).click();
    await expect(stage(ownerPage)).toContainText("Collect");

    const memberPage = await openRetros(browser, member, workspace.name);
    await expect(memberPage.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "New retrospective" })).toHaveCount(0);
    await expect(memberPage.getByRole("button", { name: /^Start / })).toHaveCount(0);
    await addTopic(memberPage, "To improve", "Flaky CI");

    await addTopic(ownerPage, "Went well", "Pairing");
    await expect(ownerPage.getByText("1 topic from others stays hidden until grouping.")).toBeVisible(LIVE);
    await expect(ownerPage.getByText("Flaky CI")).toHaveCount(0);

    await ownerPage.getByRole("button", { name: "Start Group" }).click();
    await expect(ownerPage.getByText("Flaky CI")).toBeVisible();
    await ownerPage.getByLabel("Move “Flaky CI” to").selectOption({ label: "New group" });
    const group = ownerPage.getByRole("region", { name: "Flaky CI" });
    await group.getByRole("textbox", { name: /^Name of/ }).fill("Build health");
    await group.getByRole("textbox", { name: /^Name of/ }).press("Enter");
    await expect(ownerPage.getByRole("region", { name: "Build health" })).toBeVisible();

    await ownerPage.getByRole("button", { name: "Start Vote" }).click();
    await expect(ownerPage.getByText("2 of 2 votes left")).toBeVisible();
    await expect(memberPage.getByText("2 of 2 votes left")).toBeVisible(LIVE);
    await memberPage.getByRole("button", { name: "Add a vote to Build health" }).click();
    await memberPage.getByRole("button", { name: "Add a vote to Build health" }).click();
    await expect(memberPage.getByText("0 of 2 votes left")).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Add a vote to Pairing" })).toBeDisabled();
    await ownerPage.getByRole("button", { name: "Add a vote to Pairing" }).click();
    await expect(ownerPage.getByText("1 of 2 votes left")).toBeVisible();

    await ownerPage.getByRole("button", { name: "Start Discuss" }).click();
    const ranked = ownerPage.getByRole("listitem", { name: "Build health" });
    await expect(ranked.getByText("2 votes")).toBeVisible();
    await ownerPage.getByRole("button", { name: "Take notes on Build health" }).click();
    await ownerPage.getByLabel("Root causes").fill("Shared runners are overloaded");
    await ownerPage.getByLabel("Take action").check({ force: true });
    await ownerPage.getByRole("button", { name: "Save notes" }).click();
    await expect(ownerPage.getByText("Shared runners are overloaded")).toBeVisible();

    await ownerPage.getByRole("button", { name: "Start Actions" }).click();
    await expect(stage(ownerPage)).toContainText("Actions");
    await expect(memberPage.getByText("The facilitator records the actions the team agrees on.")).toBeVisible(LIVE);
    await expect(memberPage.getByRole("button", { name: /^Add an action for/ })).toHaveCount(0);
    await ownerPage.getByRole("button", { name: "Close retrospective" }).click();
    await expect(stage(ownerPage)).toContainText("Closed");
    await expect(ownerPage.getByRole("heading", { name: "Most voted" })).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "Most voted" })).toBeVisible(LIVE);
  });
});
