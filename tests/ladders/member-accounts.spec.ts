import { expect, seedSharedTeam, test } from "./fixtures";
import { hasSecondAccount } from "../../scripts/ladders-auth";
import { LaddersApp, uniqueName } from "./ladders-app";

/**
 * A manager invites the person behind a member to link their own account.
 *
 * The invite is copied from the member's share menu, opened by the second test
 * account, and claimed once; from then on that account lands on its own member
 * page instead of the team. Unlinking puts the invite back in the menu.
 */

const MENU = "split-menu-member_share_self";

test.describe("Ladders member accounts @sharing", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });
  test.skip(!hasSecondAccount(), "needs the second test account");

  test("an invited person links their account and sees only their member page", async ({
    data,
    page,
    collaborator,
  }) => {
    test.setTimeout(60_000);
    const name = uniqueName("E2E Linked");
    const { team, workspace } = await seedSharedTeam(data, name);
    const member = await data.createMember({ name, teamId: team.id });

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.selectWorkspace(workspace.name);
    await app.openTeamMember(member.name);
    await page.getByTestId(MENU).click();
    await page.getByTestId("split-item-member_share_account_invite").click();
    await expect(page.getByTestId("alert-modal")).toContainText("Invite copied.");
    await page.getByTestId("alert-modal-close").click();
    const invite = await page.evaluate(() => navigator.clipboard.readText());
    expect(invite).toMatch(/^http:\/\/localhost:5175\/#\/join\/[0-9a-f-]{36}$/);
    const path = new URL(invite).hash.slice(1);

    await collaborator.open(`/#${path}`);
    await expect(collaborator.page.getByTestId("join-invite")).toContainText(
      `You were invited as ${member.name} in the ${workspace.name} workspace.`,
    );
    await collaborator.page.getByRole("button", { name: "Link my account" }).click();
    await expect(collaborator.page.getByTestId("member-home-tab")).toContainText(member.name);
    await expect(collaborator.page.getByTestId("workspace-switcher")).toContainText("Member");
    await expect(collaborator.page.getByTestId("main-tabs")).toHaveCount(0);

    // The invite works once.
    await collaborator.open(`/#${path}`);
    await expect(collaborator.page.getByText("This invite was already used or has expired.")).toBeVisible();

    await page.reload();
    await page.getByTestId(MENU).click();
    await expect(page.getByTestId("split-item-member_share_account_invite")).toHaveCount(0);
    await page.getByTestId("split-item-member_share_account_unlink").click();
    await expect(page.getByTestId("alert-modal")).toContainText("no longer linked");
    await page.getByTestId("alert-modal-close").click();
    await page.getByTestId(MENU).click();
    await expect(page.getByTestId("split-item-member_share_account_invite")).toBeVisible();
  });
});
