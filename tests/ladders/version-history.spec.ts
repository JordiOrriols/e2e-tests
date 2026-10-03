import { expect, seedMember, test } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";

/**
 * The history of an assessment: who wrote what, and how it is read.
 *
 * Everything here starts from versions written straight to the database, because
 * getting a manager, two peer authors and a published copy into the history
 * through the UI would be a longer test of the form than of the history.
 */

const FILTER_GROUP = "Filter versions by author";
const ANA = "Ana Iversen";
const BEN = "Ben Ostrowski";

/** A manager's own published version plus one from each of two peer authors. */
async function memberWithHistory(
  data: import("../../scripts/ladders-data").LaddersData,
) {
  const member = await seedMember(data, uniqueName("E2E History"));
  const manager = await data.createEvaluation(member.id, { kind: "manager" });
  const ana = await data.createEvaluation(member.id, {
    kind: "peer",
    authorName: ANA,
  });
  const ben = await data.createEvaluation(member.id, {
    kind: "peer",
    authorName: BEN,
  });
  await data.setViewEnabled(member.id, true);
  return { member, manager, ana, ben };
}

/** The history row written by one author. */
function rowFor(page: import("@playwright/test").Page, author: string) {
  return page.getByTestId("version-row").filter({ hasText: author });
}

test.describe("Ladders version history @versions", () => {
  test("each author gets a filter chip that hides only their own versions", async ({
    data,
    page,
  }) => {
    const { member } = await memberWithHistory(data);

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);

    const chips = page.getByRole("group", { name: FILTER_GROUP });
    await expect(chips.getByRole("button", { name: "Manager" })).toBeVisible();
    await expect(
      chips.getByRole("button", { name: `Peer · ${ANA}` }),
    ).toBeVisible();
    await expect(page.getByTestId("version-row")).toHaveCount(3);

    await chips.getByRole("button", { name: `Peer · ${ANA}` }).click();

    // One author steps out of the way; the other two stay put.
    await expect(page.getByTestId("version-row")).toHaveCount(2);
    await expect(rowFor(page, ANA)).toHaveCount(0);
    await expect(rowFor(page, BEN)).toHaveCount(1);
    await expect(
      chips.getByRole("button", { name: `Peer · ${ANA}` }),
    ).toHaveAttribute("aria-pressed", "false");

    await chips.getByRole("button", { name: `Peer · ${ANA}` }).click();

    await expect(page.getByTestId("version-row")).toHaveCount(3);
    await expect(
      chips.getByRole("button", { name: `Peer · ${ANA}` }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("hiding every author says so instead of showing an empty list", async ({
    data,
    page,
  }) => {
    const { member } = await memberWithHistory(data);

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);

    const chips = page.getByRole("group", { name: FILTER_GROUP });
    for (const author of ["Manager", `Peer · ${ANA}`, `Peer · ${BEN}`]) {
      await chips.getByRole("button", { name: author }).click();
    }

    await expect(page.getByTestId("version-row")).toHaveCount(0);
    await expect(page.getByText("No versions saved yet")).toBeVisible();
  });

  test("a single author is not given a filter to use", async ({
    data,
    page,
  }) => {
    const member = await seedMember(data, uniqueName("E2E HistorySingle"));
    await data.createEvaluation(member.id, { kind: "manager" });

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);

    await expect(page.getByTestId("version-row")).toHaveCount(1);
    await expect(page.getByRole("group", { name: FILTER_GROUP })).toHaveCount(
      0,
    );
  });

  test("a version can be put on the chart next to the one being read", async ({
    data,
    page,
  }) => {
    const { member, ana } = await memberWithHistory(data);

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);

    // The version on screen cannot be compared with itself.
    await expect(
      rowFor(page, "Manager").getByTestId("version-compare"),
    ).toBeDisabled();
    await expect(
      rowFor(page, ANA).getByTestId("version-compare"),
    ).toHaveAttribute("aria-pressed", "false");

    await rowFor(page, ANA).getByTestId("version-compare").click();

    await expect(
      rowFor(page, ANA).getByTestId("version-compare"),
    ).toHaveAttribute("aria-pressed", "true");
    // The comparison is read as another set of comments on the current version.
    await expect(page.getByTestId("comment-groups")).toContainText(ANA);

    await rowFor(page, ANA).getByTestId("version-compare").click();
    await expect(page.getByTestId("comment-groups")).not.toContainText(ANA);
  });

  test("a peer version can be sent back to draft and published again", async ({
    data,
    page,
  }) => {
    const { member, ana } = await memberWithHistory(data);

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);
    await expect(
      rowFor(page, ANA).getByTestId("version-status"),
    ).toHaveAttribute("data-status", "draft");

    await rowFor(page, ANA).getByTestId("version-publish").click();

    await expect
      .poll(
        async () =>
          (await data.listEvaluations(member.id)).find((e) => e.id === ana.id)
            ?.status,
      )
      .toBe("published");
    await expect(rowFor(page, ANA).getByTestId("version-status")).toHaveText(
      "Published",
    );
    await expect(rowFor(page, ANA).getByTestId("version-publish")).toHaveText(
      "Return to draft",
    );

    // And back again, which is what a manager does when a peer version was
    // published too early.
    await rowFor(page, ANA).getByTestId("version-publish").click();

    await expect
      .poll(
        async () =>
          (await data.listEvaluations(member.id)).find((e) => e.id === ana.id)
            ?.status,
      )
      .toBe("draft");
    await expect(rowFor(page, ANA).getByTestId("version-status")).toHaveText(
      "Draft",
    );
  });

  test("what the history shows is what the evaluated person is shown", async ({
    data,
    page,
    shared,
  }) => {
    const { member, manager } = await memberWithHistory(data);

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);

    const authors = async () =>
      await shared.page.getByTestId("version-author").allInnerTexts();

    // Only published versions reach the person, so one author's draft is not
    // theirs to read even though the manager can see it in the history.
    expect(await authors()).toHaveLength(1);
    expect((await authors())[0]).toContain("Manager");

    await data.updateEvaluationStatus(manager.id, "published");
    await expect.poll(async () => (await authors()).length).toBe(2);

    // Self versions are the one draft the person is allowed to see.
    const self = await data.createEvaluation(member.id, { kind: "self" });
    await data.setViewEnabled(member.id, true);
    await shared.page.reload();
    await expect.poll(async () => (await authors()).length).toBe(3);
    expect(
      await shared.page
        .getByTestId("version-row")
        .filter({ hasText: "Self" })
        .count(),
    ).toBe(1);

    await data.updateEvaluationStatus(self.id, "published");
    await shared.page.reload();
    await expect.poll(async () => (await authors()).length).toBe(4);
  });
});
