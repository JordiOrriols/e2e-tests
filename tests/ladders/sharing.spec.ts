import { test, expect, seedTeam } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";
import type { LaddersData } from "../../scripts/ladders-data";
import { hasSecondAccount } from "../../scripts/ladders-auth";

/**
 * Team sharing between two real users.
 *
 * The owner side runs on its own: sharing, changing a permission and removing a
 * collaborator are all owner actions. The collaborator side needs the second
 * account to be signed in, which globalSetup only manages once that account has
 * confirmed its email, so those tests skip rather than fail when it has not.
 */

const SECOND_ACCOUNT = process.env.LADDERS_TEST2_EMAIL;
const OWNER_EMAIL = process.env.LADDERS_TEST_EMAIL;

/** An address that is well formed but belongs to nobody. */
const STRANGER_EMAIL = "e2e-no-such-user@example.com";

/** Shown when the collaborator side cannot run. */
const SKIP_REASON =
  "the collaborator account cannot sign in yet (LADDERS_TEST2_EMAIL not confirmed)";

const SHARE_TIMEOUT = 8_000;

test.describe("Ladders team sharing", () => {
  test("shares a team with an email", async ({ page, data }) => {
    const app = new LaddersApp(page);
    const teamName = uniqueName("E2E Shared");
    const email = SECOND_ACCOUNT ?? STRANGER_EMAIL;
    const team = await seedTeam(data, teamName);

    await app.gotoHome();
    await app.openShareDialog(teamName);
    await app.share(email, "viewer");

    await app.waitForShareRow(email);
    // The row has to exist in the database, not just in the dialog: a share the
    // backend refused would still render if the app ignored the error.
    await expect
      .poll(
        async () => (await data.listShares(team.id)).map((s) => s.access_level),
        {
          timeout: SHARE_TIMEOUT,
        },
      )
      .toEqual(["viewer"]);
  });

  test("raises a collaborator from viewer to editor", async ({
    page,
    data,
  }) => {
    const app = new LaddersApp(page);
    const teamName = uniqueName("E2E Shared");
    const email = SECOND_ACCOUNT ?? STRANGER_EMAIL;
    const team = await seedTeam(data, teamName);
    await data.shareTeam(team.id, email, "viewer");

    await app.gotoHome();
    await app.openShareDialog(teamName);
    await app.waitForShareRow(email);
    await app.changeShareAccess(email, "editor");

    await expect
      .poll(
        async () => (await data.listShares(team.id)).map((s) => s.access_level),
        {
          timeout: SHARE_TIMEOUT,
        },
      )
      .toEqual(["editor"]);
    await expect(
      app.shareRow(email).getByTestId("share-row-access"),
    ).toHaveValue("editor");
  });

  test("removes a collaborator", async ({ page, data }) => {
    const app = new LaddersApp(page);
    const teamName = uniqueName("E2E Shared");
    const email = SECOND_ACCOUNT ?? STRANGER_EMAIL;
    const team = await seedTeam(data, teamName);
    await data.shareTeam(team.id, email, "editor");

    await app.gotoHome();
    await app.openShareDialog(teamName);
    await app.waitForShareRow(email);
    await app.removeShare(email);

    await expect(app.shareRow(email)).toHaveCount(0);
    await expect
      .poll(async () => data.listShares(team.id), { timeout: SHARE_TIMEOUT })
      .toEqual([]);
  });

  test("refuses to share with an address that has no account", async ({
    page,
    data,
  }) => {
    const app = new LaddersApp(page);
    const teamName = uniqueName("E2E Shared");
    await seedTeam(data, teamName);

    await app.gotoHome();
    await app.openShareDialog(teamName);
    await app.share(STRANGER_EMAIL, "viewer");

    // The reason belongs on the collaborator row, so nothing is added.
    await expect(app.shareError).toBeVisible();
    await expect(app.shareRow(STRANGER_EMAIL)).toHaveCount(0);
  });

  test("refuses to share a team with yourself", async ({ page, data }) => {
    const app = new LaddersApp(page);
    const teamName = uniqueName("E2E Shared");
    await seedTeam(data, teamName);

    await app.gotoHome();
    await app.openShareDialog(teamName);
    await app.share(OWNER_EMAIL ?? "", "viewer");

    await expect(app.shareError).toBeVisible();
  });
});

test.describe("Ladders shared team as a collaborator", () => {
  test.beforeEach(() => {
    test.skip(!hasSecondAccount(), SKIP_REASON);
  });

  /** Seeds a team and shares it with the collaborator at the given level. */
  async function shareTeamWith(data: LaddersData, access: "viewer" | "editor") {
    const team = await seedTeam(data, uniqueName("E2E Shared"));
    await data.shareTeam(team.id, SECOND_ACCOUNT!, access);
    return team;
  }

  test("a viewer sees the team but cannot add members", async ({
    data,
    collaborator,
  }) => {
    const team = await shareTeamWith(data, "viewer");
    const app = new LaddersApp(collaborator.page);

    await app.gotoHome();
    await collaborator.page.getByTestId("tab-team").click();

    const section = app.teamSectionByName(team.name);
    await expect(section).toBeVisible();
    // The permission is shown, so the viewer knows why they cannot change it.
    await expect(section.getByTestId(`team-access-${team.id}`)).toHaveAttribute(
      "data-access",
      "viewer",
    );
    // Owner only actions are not offered to a collaborator at all.
    await expect(section.getByTestId("add-member-button")).toHaveCount(0);
    await expect(section.getByTestId("team-share-open")).toHaveCount(0);
    await expect(section.getByTestId("team-rename-open")).toHaveCount(0);
  });

  test("a viewer reads the members the owner added", async ({
    data,
    collaborator,
  }) => {
    const team = await shareTeamWith(data, "viewer");
    const memberName = uniqueName("E2E SharedMember");
    await data.createMember({
      name: memberName,
      role: "Added by the owner",
      teamId: team.id,
    });

    const app = new LaddersApp(collaborator.page);
    await app.gotoHome();
    await collaborator.page.getByTestId("tab-team").click();

    await expect(
      app.teamSectionByName(team.name).getByText(memberName),
    ).toBeVisible();
  });

  test("a viewer sees a member without any way to change it", async ({
    data,
    collaborator,
  }) => {
    const team = await shareTeamWith(data, "viewer");
    const memberName = uniqueName("E2E ReadOnly");
    const member = await data.createMember({
      name: memberName,
      role: "Read only",
      teamId: team.id,
    });

    const app = new LaddersApp(collaborator.page);
    await app.gotoHome();
    await collaborator.page.getByTestId("tab-team").click();

    const card = collaborator.page.getByTestId(`member-card-${member.id}`);
    await expect(card).toContainText(memberName);
    // Read only means read only: no edit, no delete, and the card does not even
    // open, so there is nothing to change from.
    await expect(card.getByTestId(`member-edit-${member.id}`)).toHaveCount(0);
    await expect(card.getByTestId(`member-delete-${member.id}`)).toHaveCount(0);
  });

  test("the database refuses a viewer who tries to edit anyway", async ({
    data,
    collaboratorData,
  }) => {
    const team = await shareTeamWith(data, "viewer");
    const memberName = uniqueName("E2E ViewerWrite");
    const member = await data.createMember({
      name: memberName,
      role: "Read only",
      teamId: team.id,
    });

    // The UI hides the controls; this is the guarantee behind that hiding.
    // PostgREST answers a write filtered out by row level security with an empty
    // result rather than an error, so the proof is that nothing changed.
    await collaboratorData.patchMember(member.id, {
      name: "Renamed by a viewer",
    });
    expect((await data.member(member.id))?.name).toBe(memberName);
  });

  test("the database accepts the same edit from an editor", async ({
    data,
    collaboratorData,
  }) => {
    const team = await shareTeamWith(data, "editor");
    const memberName = uniqueName("E2E EditorWrite");
    const member = await data.createMember({
      name: memberName,
      role: "Editable",
      teamId: team.id,
    });

    await collaboratorData.patchMember(member.id, {
      name: "Renamed by an editor",
    });
    expect((await data.member(member.id))?.name).toBe("Renamed by an editor");
  });

  test("an editor can add a member to the shared team", async ({
    data,
    collaborator,
  }) => {
    const team = await shareTeamWith(data, "editor");
    const app = new LaddersApp(collaborator.page);

    await app.gotoHome();
    await collaborator.page.getByTestId("tab-team").click();
    const section = app.teamSectionByName(team.name);
    await expect(section.getByTestId(`team-access-${team.id}`)).toHaveAttribute(
      "data-access",
      "editor",
    );

    const memberName = uniqueName("E2E EditorAdded");
    await section.getByTestId("add-member-button").click();
    // The team is carried through the URL so the new member lands in it.
    await expect(collaborator.page).toHaveURL(
      new RegExp(`/member/new\\?team=${team.id}`),
    );
    await collaborator.page.getByTestId("assessment-name").fill(memberName);
    await collaborator.page
      .getByTestId("assessment-role")
      .fill("Added by an editor");
    await app.setLevel("Technology", 2);
    await app.publishMember();

    let created: { id: string; team_id: string | null } | undefined;
    await expect
      .poll(
        async () => {
          created = (await data.listMembers()).find(
            (m) => m.name === memberName,
          );
          return created?.team_id;
        },
        { timeout: SHARE_TIMEOUT },
      )
      .toBe(team.id);
    // The member was created through the UI by the other user, so cleanup has to
    // be told about it: an empty team can be deleted, a team with a leftover
    // member cannot, and the failure would be reported as the team, not the cause.
    data.trackMember(created!);
  });

  test("removing the share takes the team away", async ({
    data,
    collaborator,
  }) => {
    const team = await shareTeamWith(data, "viewer");
    const app = new LaddersApp(collaborator.page);

    await app.gotoHome();
    await collaborator.page.getByTestId("tab-team").click();
    await expect(app.teamSectionByName(team.name)).toBeVisible();

    const [share] = await data.listShares(team.id);
    await data.removeShare(team.id, share.user_id);

    // A reload is the honest way to observe it: the collaborator has to reload
    // to find out, so that is what the app is allowed to make them do.
    await collaborator.page.reload();
    await collaborator.page.getByTestId("tab-team").click();
    await expect(app.teamSectionByName(team.name)).toHaveCount(0);
  });
});
