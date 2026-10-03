import { expect, seedMember, test } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";
import { hasSecondAccount } from "../../scripts/ladders-auth";
import type { LaddersData } from "../../scripts/ladders-data";

/**
 * Who can say something about a goal, and what happens to it afterwards.
 *
 * A goal carries two kinds of comment: one from the manager and one from the
 * person the goal belongs to, which is appended through the view link rather
 * than the app. The database decides which of the two a caller is allowed to be,
 * and it is the only place that decision is written down, so most of what follows
 * is checked against it rather than against the screen.
 */

const SECOND_ACCOUNT = process.env.LADDERS_TEST2_EMAIL;
const COMMENT_TIMEOUT = 8_000;

/** Comments are stored as a list of objects, newest last. */
async function commentsOf(data: LaddersData, goalId: string) {
  return (await data.goal(goalId))?.comments as {
    text: string;
    authorKind: string;
  }[];
}

/** A member with one goal, and its view link open. */
async function memberWithGoal(data: LaddersData) {
  const member = await seedMember(data, uniqueName("E2E GoalTalk"));
  await data.setViewEnabled(member.id, true);
  const goal = await data.createGoal({
    memberId: member.id,
    title: uniqueName("E2E Discussed"),
  });
  return { member, goal };
}

test.describe("Ladders goal comments @goals", () => {
  test("the evaluated person comments on a goal through their view link", async ({
    data,
    shared,
  }) => {
    const { member, goal } = await memberWithGoal(data);
    const fromMember = uniqueName("E2E IWillDoIt");

    const app = new LaddersApp(shared.page);
    await app.goto(`/#/v/${member.view_token}`);
    await shared.page.getByTestId("assessment-tab-goals").click();

    const card = app.goalById(goal.id);
    await card.getByTestId("goal-comment-input").fill(fromMember);
    await card.getByTestId("goal-comment-submit").click();

    await expect
      .poll(async () => (await commentsOf(data, goal.id)).map((c) => c.text))
      .toContain(fromMember);
    // The link proves who spoke: without it a member could pass for the manager.
    expect(await commentsOf(data, goal.id)).toContainEqual(
      expect.objectContaining({ text: fromMember, authorKind: "member" }),
    );

    // And the manager reads the same conversation on their own screen.
    const managerApp = new LaddersApp(shared.page);
    await managerApp.goto(`/#/member/${member.id}`);
    await shared.page.getByTestId("assessment-tab-goals").click();
    await expect(
      managerApp.goalById(goal.id).getByText(fromMember),
    ).toBeVisible();
  });

  test("a manager reply is recorded as coming from the manager", async ({
    data,
    page,
    shared,
  }) => {
    const { member, goal } = await memberWithGoal(data);
    const fromMember = uniqueName("E2E FromThem");
    const fromManager = uniqueName("E2E FromManager");

    const memberApp = new LaddersApp(shared.page);
    await memberApp.goto(`/#/v/${member.view_token}`);
    await shared.page.getByTestId("assessment-tab-goals").click();
    await memberApp
      .goalById(goal.id)
      .getByTestId("goal-comment-input")
      .fill(fromMember);
    await memberApp
      .goalById(goal.id)
      .getByTestId("goal-comment-submit")
      .click();

    const managerApp = new LaddersApp(page);
    await managerApp.gotoHome();
    await managerApp.openGoals(member.name);
    const card = managerApp.goalById(goal.id);
    await card.getByTestId("goal-comment-input").fill(fromManager);
    await card.getByTestId("goal-comment-submit").click();

    await expect
      .poll(async () =>
        (await commentsOf(data, goal.id)).map(
          (c) => `${c.authorKind}:${c.text}`,
        ),
      )
      .toEqual([`member:${fromMember}`, `manager:${fromManager}`]);
  });

  test("the conversation can be added to but never taken back", async ({
    data,
  }) => {
    const { goal } = await memberWithGoal(data);
    const said = uniqueName("E2E SaidOnce");
    await data.appendGoalComment(goal.id, said);

    // Editing the goal itself is allowed, so the refusal below is about the
    // comments and not about the caller lacking permission to write here.
    await data.renameGoal(goal.id, uniqueName("E2E Retitled"));

    // Editing, reordering or removing a saved comment is refused outright.
    const stored = await commentsOf(data, goal.id);
    await expect(
      data.replaceGoalComments(goal.id, [
        { ...stored[0], text: "Rewritten after the fact" },
      ]),
    ).rejects.toThrow(/permission denied for table smart_goals/);

    // The original text is still what was written.
    expect((await commentsOf(data, goal.id)).map((c) => c.text)).toEqual([
      said,
    ]);
  });

  test("an empty comment is refused rather than stored as a blank", async ({
    data,
  }) => {
    const { goal } = await memberWithGoal(data);

    await expect(data.appendGoalComment(goal.id, "   ")).rejects.toThrow(
      /comment must contain 1 to 10000 characters/,
    );
    expect(await commentsOf(data, goal.id)).toEqual([]);
  });

  test("a comment longer than the column allows is refused", async ({
    data,
  }) => {
    const { goal } = await memberWithGoal(data);

    await expect(
      data.appendGoalComment(goal.id, "x".repeat(10_001)),
    ).rejects.toThrow(/comment must contain 1 to 10000 characters/);
  });

  test.describe("a viewer of a shared team", () => {
    test.skip(
      !hasSecondAccount(),
      "the collaborator account cannot sign in yet (LADDERS_TEST2_EMAIL not confirmed)",
    );

    test("is refused when it tries to comment on a goal", async ({
      data,
      collaboratorData,
    }) => {
      const member = await seedMember(data, uniqueName("E2E SharedGoal"));
      const goal = await data.createGoal({
        memberId: member.id,
        title: uniqueName("E2E SharedDiscussed"),
      });
      await data.shareTeam(member.team_id!, SECOND_ACCOUNT!, "viewer");

      // A viewer may read the goal but not join the conversation in it.
      await expect(
        collaboratorData.appendGoalComment(goal.id, "Not my place to say"),
      ).rejects.toThrow(/comment access denied/);
      expect(await commentsOf(data, goal.id)).toEqual([]);
    });

    test("is allowed to comment once it is an editor", async ({
      data,
      collaboratorData,
    }) => {
      const member = await seedMember(data, uniqueName("E2E SharedGoalEdit"));
      const goal = await data.createGoal({
        memberId: member.id,
        title: uniqueName("E2E SharedEdited"),
      });
      await data.shareTeam(member.team_id!, SECOND_ACCOUNT!, "editor");
      const said = uniqueName("E2E EditorSays");

      await collaboratorData.appendGoalComment(goal.id, said);

      await expect
        .poll(
          async () => (await commentsOf(data, goal.id)).map((c) => c.text),
          {
            timeout: COMMENT_TIMEOUT,
          },
        )
        .toEqual([said]);
      // The comment is filed under the manager, since that is who may write here.
      expect((await commentsOf(data, goal.id))[0].authorKind).toBe("manager");
    });
  });
});
