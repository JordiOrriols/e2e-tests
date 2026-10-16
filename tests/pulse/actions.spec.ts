import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  api, createWorkspace, openPulse, removeWorkspace, selectWorkspace, signIn, type Account,
} from "./pulse-helpers";

/** Pages refresh every few seconds, so cross-account checks wait past one poll. */
const LIVE = { timeout: 15_000 };
const STAGES = ["collect", "group", "vote", "discuss", "actions"];

test.describe("Pulse improvement actions", () => {
  const contexts: BrowserContext[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  test.afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  const rpc = (account: Account, name: string, body: Record<string, unknown>) =>
    api(account, `rpc/${name}`, { method: "POST", body: JSON.stringify(body) });

  async function createRetro(owner: Account, workspace: string, title: string, held: string) {
    const id = String(await rpc(owner, "create_pulse_retro", {
      workspace, retro_title: title, held, retro_period: null, retro_goal: null,
      retro_template: "open", is_anonymous: true, votes: 3,
    }));
    return id.replace(/"/g, "");
  }

  async function open(browser: Parameters<typeof openPulse>[0], account: Account, workspace: string, tab: string) {
    const { page, context } = await openPulse(browser, account);
    contexts.push(context);
    await selectWorkspace(page, workspace);
    await page.getByRole("navigation", { name: "Pulse pages" }).getByRole("link", { name: tab, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: tab })).toBeVisible();
    return page;
  }

  test("an action agreed in a retro is followed by its owner and reviewed in the next one", async ({ browser }) => {
    const owner = await signIn();
    const member = await signIn(true);
    const workspace = await createWorkspace(owner, `Pulse ${randomUUID().slice(0, 8)}`);
    cleanup.push(() => removeWorkspace(owner, workspace.id));
    await rpc(owner, "share_workspace", {
      workspace: workspace.id, account_email: member.user.email, app_name: "pulse", access: "viewer",
    });
    const first = await createRetro(owner, workspace.id, "Sprint A", "2026-01-01");
    for (const stage of STAGES) await rpc(owner, "set_pulse_retro_stage", { retro: first, new_stage: stage });
    const title = `Rotate reviewers ${randomUUID().slice(0, 4)}`;

    const ownerPage = await open(browser, owner, workspace.name, "Retrospectives");
    await expect(ownerPage.getByRole("heading", { level: 2, name: "Sprint A" })).toBeVisible();
    await ownerPage.getByRole("button", { name: "Add action", exact: true }).click();
    const dialog = ownerPage.getByRole("dialog", { name: "New action" });
    await dialog.getByLabel("Action", { exact: true }).fill(title);
    await dialog.getByLabel("Owner").selectOption({ label: member.user.email });
    await dialog.getByLabel("Due date").fill("2026-01-15");
    await dialog.getByLabel("Priority").selectOption({ label: "High" });
    await dialog.getByRole("button", { name: "Create action" }).click();
    await expect(dialog).toBeHidden();
    await expect(ownerPage.getByRole("article", { name: title })).toContainText(member.user.email);
    await ownerPage.getByRole("button", { name: "Close retrospective" }).click();
    await expect(ownerPage.getByRole("region", { name: "Agreed actions" }).getByRole("article", { name: title })).toBeVisible();

    const memberPage = await open(browser, member, workspace.name, "Actions");
    const card = memberPage.getByRole("article", { name: title });
    await expect(card).toContainText("Overdue");
    await expect(card).toContainText("From Sprint A");
    await expect(memberPage.getByRole("button", { name: "New action" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: /^(Edit|Delete) “/ })).toHaveCount(0);
    await card.getByLabel(`Status of “${title}”`).selectOption({ label: "In progress" });
    await expect(memberPage.getByRole("heading", { level: 2, name: /^In progress/ })).toBeVisible();
    await card.getByRole("button", { name: "History" }).click();
    const history = card.getByRole("region", { name: `History of “${title}”` });
    await expect(history).toContainText(`${member.user.email} moved it to In progress`);
    await history.getByLabel(`Add a note to “${title}”`).fill("Rota drafted with the team");
    await history.getByRole("button", { name: "Add note" }).click();
    await expect(history.getByText("Rota drafted with the team")).toBeVisible();

    await createRetro(owner, workspace.id, "Sprint B", new Date().toISOString().slice(0, 10));
    await ownerPage.reload();
    await expect(ownerPage.getByRole("heading", { level: 2, name: "Sprint B" })).toBeVisible();
    const carried = ownerPage.getByRole("region", { name: "Still open" }).getByRole("article", { name: title });
    await expect(carried).toContainText("From Sprint A");
    await expect(carried.getByLabel(`Status of “${title}”`)).toHaveValue("in_progress");
    await carried.getByRole("button", { name: "History" }).click();
    await expect(carried.getByText("Rota drafted with the team")).toBeVisible();
  });
});
