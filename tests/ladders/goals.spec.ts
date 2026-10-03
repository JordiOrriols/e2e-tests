import { test, expect, seedMember } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";

/**
 * Goals are managed from the assessment screen and only in manager mode.
 * Each test seeds its own member, so nothing leaks between runs.
 */
test.describe("Ladders goals @goals", () => {
  test("creates a goal with a due date and a description", async ({
    page,
    data,
  }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E Goals");
    const title = uniqueName("E2E Reach level 4");

    await seedMember(data, memberName);
    await app.gotoHome();
    await app.openGoals(memberName);

    await app.createGoal({
      title,
      dueDate: "2027-03-31",
      description: "Ship the migration and mentor a teammate.",
    });

    const goal = app.goalByTitle(title);
    await expect(goal.getByTestId("goal-title-field")).toHaveValue(title);
    await expect(goal.getByTestId("goal-date-field")).toHaveValue("2027-03-31");
    await expect(goal.getByTestId("goal-description-field")).toHaveValue(
      "Ship the migration and mentor a teammate.",
    );
    await expect(goal.getByTestId("goal-progress-value")).toHaveText("0%");
  });

  test("keeps the create button disabled until the title has content", async ({
    page,
    data,
  }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E GoalsDisabled");

    await seedMember(data, memberName);
    await app.gotoHome();
    await app.openGoals(memberName);

    await expect(page.getByTestId("goal-create-submit")).toBeDisabled();
    await page.getByTestId("goal-title-input").fill("   ");
    await expect(page.getByTestId("goal-create-submit")).toBeDisabled();
    await page.getByTestId("goal-title-input").fill(uniqueName("E2E Enabled"));
    await expect(page.getByTestId("goal-create-submit")).toBeEnabled();
  });

  test("updates the progress of a goal and saves it", async ({
    page,
    data,
  }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E Progress");
    const title = uniqueName("E2E Ship it");

    await seedMember(data, memberName);
    await app.gotoHome();
    await app.openGoals(memberName);
    await app.createGoal({ title });

    const goalId = await app.goalIdByTitle(title);
    const goal = app.goalById(goalId);
    await goal.getByTestId("goal-progress").fill("60");
    await expect(goal.getByTestId("goal-progress-value")).toHaveText("60%");

    // Managers persist the whole goal with one button; progress has no own save.
    await goal.getByTestId("goal-save").click();

    // Waiting on the stored row, not on the UI: reloading straight after the
    // click would abort the in flight PATCH and prove nothing either way.
    await expect.poll(async () => (await data.goal(goalId))?.progress).toBe(60);

    await page.reload();
    await page.getByTestId("assessment-tab-goals").click();
    await expect(
      app.goalByTitle(title).getByTestId("goal-progress-value"),
    ).toHaveText("60%");
  });

  test("renames a goal and saves it", async ({ page, data }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E GoalEdit");
    const original = uniqueName("E2E Old title");
    const renamed = uniqueName("E2E New title");

    await seedMember(data, memberName);
    await app.gotoHome();
    await app.openGoals(memberName);
    await app.createGoal({ title: original });

    const goalId = await app.goalIdByTitle(original);
    const goal = app.goalById(goalId);
    await goal.getByTestId("goal-title-field").fill(renamed);
    await goal.getByTestId("goal-save").click();

    await expect
      .poll(async () => (await data.goal(goalId))?.title)
      .toBe(renamed);

    await page.reload();
    await page.getByTestId("assessment-tab-goals").click();
    await expect(app.goalByTitle(renamed)).toBeVisible();
    await expect(app.goalByTitle(original)).toHaveCount(0);
  });

  test("adds a comment on a goal and keeps it after a reload", async ({ page, data }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E Comment");
    const title = uniqueName("E2E Discussed");
    const comment = uniqueName("E2E Agreed in the review");

    await seedMember(data, memberName);
    await app.gotoHome();
    await app.openGoals(memberName);
    await app.createGoal({ title });

    const goalId = await app.goalIdByTitle(title);
    const goal = app.goalById(goalId);
    await goal.getByTestId("goal-comment-input").fill(comment);
    await goal.getByTestId("goal-comment-submit").click();

    await expect
      .poll(async () =>
        JSON.stringify((await data.goal(goalId))?.comments ?? []),
      )
      .toContain(comment);

    await page.reload();
    await page.getByTestId("assessment-tab-goals").click();
    await expect(app.goalByTitle(title).getByText(comment)).toBeVisible();
  });

  test("deletes a goal", async ({ page, data }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E GoalDelete");
    const title = uniqueName("E2E Temporary");

    await seedMember(data, memberName);
    await app.gotoHome();
    await app.openGoals(memberName);
    await app.createGoal({ title });

    const goalId = await app.goalIdByTitle(title);
    const goal = app.goalById(goalId);
    await goal.getByRole("button", { name: /delete/i }).click();

    await expect.poll(async () => await data.goal(goalId)).toBeUndefined();

    await page.reload();
    await page.getByTestId("assessment-tab-goals").click();
    await expect(app.goalByTitle(title)).toHaveCount(0);
  });
});
