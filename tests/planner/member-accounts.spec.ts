import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  api, authenticatedPage, calendarDay, createRoster, createWorkspace, removeWorkspace, selectWorkspace,
  showMonth, signIn, type Account,
} from "./planner-helpers";

/**
 * A person linked to their team member through an invite sees the workspace as a viewer: no
 * configuration, everyone's vacations, and only their own vacations to edit.
 */
test.describe("Planner members linked to accounts", () => {
  let owner: Account;
  let person: Account;
  const contexts: BrowserContext[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  test.afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  test("a linked person edits only their own vacations and never sees configuration", async ({ browser }) => {
    test.setTimeout(90_000);
    owner = await signIn();
    person = await signIn(true);
    const workspace = await createWorkspace(owner, `Linked ${randomUUID().slice(0, 8)}`);
    cleanup.push(() => removeWorkspace(owner, workspace.id));
    const roster = await createRoster(owner, `Linked ${randomUUID().slice(0, 8)}`, [
      { name: "Ada", role: "Engineer", planning_role: "backend" },
      { name: "Grace", role: "Engineer", planning_role: "frontend" },
    ], workspace.id);
    const [ada, grace] = roster.members;

    const invite = await api<string>(owner, "rpc/create_member_invite", {
      method: "POST", body: JSON.stringify({ member: ada!.id }),
    });
    await api(person, "rpc/claim_member_invite", { method: "POST", body: JSON.stringify({ invite }) });
    // The invite works once.
    await expect(api(person, "rpc/claim_member_invite", { method: "POST", body: JSON.stringify({ invite }) }))
      .rejects.toThrow("no longer valid");

    const opened = await authenticatedPage(browser, person);
    contexts.push(opened.context);
    const page = opened.page;
    await selectWorkspace(page, workspace.name);
    await expect(page.getByRole("link", { name: "Team configuration" })).toHaveCount(0);
    await page.goto(`${new URL(page.url()).origin}/#/team-configuration`);
    await expect(page.getByRole("link", { name: "Estimation", exact: true })).toHaveAttribute("aria-current", "page");

    await page.getByRole("link", { name: "Vacations", exact: true }).click();
    const member = page.getByLabel("Member", { exact: true });
    await expect(member).toHaveValue(ada!.id);
    await showMonth(page, "2026-12-07");
    await calendarDay(page, "2026-12-07").click();
    await calendarDay(page, "2026-12-08").click();
    await page.getByRole("button", { name: "Vacations", exact: true }).click();
    await expect.poll(() => api<{ date: string }[]>(owner,
      `vacations?member_id=eq.${ada!.id}&select=date&order=date`)).toEqual([{ date: "2026-12-07" }, { date: "2026-12-08" }]);

    await member.selectOption(grace!.id);
    await expect(calendarDay(page, "2026-12-09")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Vacations", exact: true })).toBeDisabled();
    await expect(api(person, "rpc/planner_set_vacations", {
      method: "POST",
      body: JSON.stringify({ member: grace!.id, start_date: "2026-12-09", end_date: "2026-12-09", working: false }),
    })).rejects.toThrow("Team edit access required");
  });
});
