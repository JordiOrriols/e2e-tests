import { test, expect, seedMember, seedTeam } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";

/**
 * Team lifecycle: create, rename, delete and move members between teams.
 *
 * Seeded rows come from PostgREST through the `data` fixture and are removed
 * after each test. The UI is only used for the action under test.
 */
test.describe("Ladders teams @teams @smoke", () => {
  test("creates a team from the UI", async ({
    page,
    data,
    defaultTeamName,
  }) => {
    const app = new LaddersApp(page);
    const name = uniqueName("E2E Create");

    await seedMember(data, "E2E Seed For Create");
    await app.gotoHome();
    await app.createTeam(name);

    await expect(app.teamSectionByName(name)).toBeVisible();
  });

  test("renames an existing team", async ({ page, data, defaultTeamName }) => {
    const app = new LaddersApp(page);
    const original = uniqueName("E2E Before");
    const renamed = uniqueName("E2E After");
    await seedTeam(data, original);

    await seedMember(data, "E2E Seed For Rename");
    await app.gotoHome();
    await app.renameTeam(original, renamed);

    await expect(app.teamSectionByName(original)).toHaveCount(0);
    await expect(app.teamSectionByName(renamed)).toBeVisible();
  });

  test("deletes a team after confirming", async ({
    page,
    data,
    defaultTeamName,
  }) => {
    const app = new LaddersApp(page);
    const name = uniqueName("E2E Delete");
    await seedTeam(data, name);

    await seedMember(data, "E2E Seed For Delete");
    await app.gotoHome();
    await app.openTeamTab();
    await expect(app.teamSectionByName(name)).toBeVisible();

    await app.deleteTeam(name);
    await expect(app.teamSectionByName(name)).toHaveCount(0);
  });

  test("keeps the team when the confirmation is cancelled", async ({
    page,
    data,
    defaultTeamName,
  }) => {
    const app = new LaddersApp(page);
    const name = uniqueName("E2E Cancelled");
    await seedTeam(data, name);
    await seedMember(data, "E2E Seed For Cancel");

    await app.gotoHome();
    await app.openTeamTab();
    await app.teamSectionByName(name).getByTestId("team-delete-open").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await page.getByTestId("confirm-dialog-cancel").click();

    await expect(page.getByTestId("confirm-dialog")).toBeHidden();
    await expect(app.teamSectionByName(name)).toBeVisible();
  });

  test("keeps the create button disabled while the name is empty", async ({
    page,
    data,
    defaultTeamName,
  }) => {
    const app = new LaddersApp(page);
    await seedMember(data, "E2E Seed For Validation");

    await app.gotoHome();
    await app.openTeamTab();
    await page.getByTestId("team-create-open").first().click();
    await expect(page.getByTestId("team-name-dialog")).toBeVisible();

    await expect(page.getByTestId("team-name-submit")).toBeDisabled();
    await page.getByTestId("team-name-input").fill("Temp name");
    await expect(page.getByTestId("team-name-submit")).toBeEnabled();

    await page.getByTestId("team-name-cancel").click();
    await expect(page.getByTestId("team-name-dialog")).toBeHidden();
  });

  test("closes the team dialog with the escape key", async ({
    page,
    data,
    defaultTeamName,
  }) => {
    const app = new LaddersApp(page);
    await seedMember(data, "E2E Seed For Escape");

    await app.gotoHome();
    await app.openTeamTab();
    await page.getByTestId("team-create-open").first().click();
    await expect(page.getByTestId("team-name-dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("team-name-dialog")).toBeHidden();
  });

  test("moves a member into another team by dragging their card", async ({
    page,
    data,
    defaultTeamName,
  }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E Mover");
    const targetName = uniqueName("E2E Target");

    await seedMember(data, memberName);
    await seedTeam(data, targetName);

    await app.gotoHome();
    await app.openTeamTab();

    const target = app.teamSectionByName(targetName);
    await expect(target).toBeVisible();
    await expect(target.locator('[data-testid^="member-card-"]')).toHaveCount(
      0,
    );

    await app.dragMemberToTeam(memberName, targetName);

    await expect(
      target.getByTestId("member-name").filter({ hasText: memberName }),
    ).toBeVisible({});
    await expect(
      app
        .teamSectionByName(defaultTeamName)
        .getByTestId("member-name")
        .filter({ hasText: memberName }),
    ).toHaveCount(0);
  });
});
