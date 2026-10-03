import { test, expect, seedMember, seedTeam, DATA_TIMEOUT } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";

test.describe("Ladders members @members @smoke", () => {
  test("adds a member to a specific team from that team's action", async ({
    page,
    data,
  }) => {
    const app = new LaddersApp(page);
    const teamName = uniqueName("E2E AddTo");
    const memberName = uniqueName("E2E Added");

    const team = await seedTeam(data, teamName);

    await app.gotoHome();
    await app.openTeamTab();
    await app
      .teamSectionByName(teamName)
      .getByTestId("add-member-button")
      .click();

    // The team is carried through the URL so the new member lands in it.
    await expect(page).toHaveURL(new RegExp(`/member/new\\?team=${team.id}`));
    await expect(page.getByTestId("assessment-name")).toBeVisible();

    await page.getByTestId("assessment-name").fill(memberName);
    await page
      .getByTestId("assessment-role")
      .fill("Added through the team action");
    await app.setLevel("Technology", 2);
    await app.publishMember();
    await expect(page).toHaveURL(/member\/(?!new)/, { timeout: DATA_TIMEOUT });
    data.trackMember({ id: page.url().split("/member/")[1] ?? "" });

    await app.gotoHome();
    await app.openTeamTab();
    await expect(
      app
        .teamSectionByName(teamName)
        .getByTestId("member-name")
        .filter({ hasText: memberName }),
    ).toBeVisible();
  });

  test("lists a new member in the individual tab", async ({ page, data }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E Solo");

    await app.createMember(memberName, "Solo role");
    data.trackMember({ id: page.url().split("/member/")[1] ?? "" });

    await app.gotoHome();
    await expect(
      app.page.getByTestId("member-name").filter({ hasText: memberName }),
    ).toBeVisible();
  });

  test("renames a member from the individual tab", async ({ page, data }) => {
    const app = new LaddersApp(page);
    const original = uniqueName("E2E Rename");
    const renamed = uniqueName("E2E Renamed");

    await seedMember(data, original);

    await app.gotoHome();
    await app.renameMember(original, renamed);

    await app.gotoHome();
    await expect(
      app.page.getByTestId("member-name").filter({ hasText: renamed }),
    ).toBeVisible();
    await expect(
      app.page.getByTestId("member-name").filter({ hasText: original }),
    ).toHaveCount(0);
  });

  test("keeps the member when the delete confirmation is cancelled", async ({
    page,
    data,
  }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E Keep");

    await seedMember(data, memberName);

    await app.gotoHome();
    const id = await app.memberIdByName(memberName);
    const card = app.page.locator(`[data-testid="member-card-${id}"]`);

    await app.openDeleteConfirm(memberName);
    await app.cancelDelete();

    await expect(card).toBeVisible();
  });

  test("deletes a member after confirming", async ({ page, data }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E Delete");

    await seedMember(data, memberName);

    await app.gotoHome();
    await app.deleteMember(memberName);

    await expect(
      app.page.getByTestId("member-name").filter({ hasText: memberName }),
    ).toHaveCount(0);
  });

  test("selects a member in the list without leaving the list", async ({
    page,
    data,
  }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E Select");

    await seedMember(data, memberName);

    await app.gotoHome();
    await app.selectMember(memberName);

    await expect(page.getByTestId("member-details")).toBeVisible();
    await expect(page.getByTestId("member-details-name")).toHaveText(
      memberName,
    );
    // Selecting is not navigation: the list stays put.
    await expect(page).toHaveURL(/\/$/);
  });

  test("opens the assessment screen from the edit action", async ({
    page,
    data,
  }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E Open");

    await seedMember(data, memberName);

    await app.gotoHome();
    const id = await app.openMember(memberName);

    await expect(page).toHaveURL(new RegExp(`/member/${id}$`));
    await expect(page.getByTestId("assessment-name")).toHaveValue(memberName);
    await expect(page.getByTestId("assessment-competencies")).toBeVisible();
  });

  test("opens the assessment screen straight from a team card", async ({
    page,
    data,
  }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E TeamOpen");

    await seedMember(data, memberName);

    await app.gotoHome();
    const id = await app.openTeamMember(memberName);

    await expect(page).toHaveURL(new RegExp(`/member/${id}$`));
    await expect(page.getByTestId("assessment-name")).toHaveValue(memberName);
  });
});
