import { expect, test } from "./fixtures";
import { LaddersApp, uniqueName, captureNextAlert } from "./ladders-app";
import { seedMember } from "./fixtures";

/**
 * What a peer link does and does not give away.
 *
 * A peer is someone outside the account who was asked for a review, so the whole
 * design is about what they can and cannot reach. The peer store loads no
 * history and writes one row per submission, and those two facts are what these
 * tests pin down.
 */

const TEAM = "Technology";

/** Opens the peer link as an anonymous visitor would. */
async function openPeerLink(
  page: import("@playwright/test").Page,
  peerToken: string,
) {
  const app = new LaddersApp(page);
  await app.goto(`/#/e/${peerToken}`);
  await expect(app.page.getByTestId("assessment-author")).toBeVisible();
  return app;
}

test.describe("Ladders peer reviews @peers", () => {
  test("a peer is shown no history at all, not even the manager's published review", async ({
    data,
    shared,
  }) => {
    const memberNote = uniqueName("E2E ManagerNote");
    const member = await seedMember(data, uniqueName("E2E PeerBlind"));
    await data.createEvaluation(member.id, {
      kind: "manager",
      status: "published",
      currentLevels: { [TEAM]: 2 },
      comments: { [TEAM]: memberNote },
    });

    const app = await openPeerLink(shared.page, member.peer_token);

    // No history panel, so no version of the manager's review is on the page.
    await expect(app.page.getByTestId("version-panel")).toHaveCount(0);
    await expect(app.page.getByText(memberNote)).toHaveCount(0);

    // And the level the manager chose is not pre-filled into the peer's answer.
    expect(await app.levelIsSelected(TEAM, 2)).toBe(false);
  });

  test("a peer who has not said who they are is told why, and nothing is written", async ({
    data,
    shared,
  }) => {
    const member = await seedMember(data, uniqueName("E2E PeerAnon"));
    const app = await openPeerLink(shared.page, member.peer_token);

    await app.setLevel(TEAM, 3);

    const said = await captureNextAlert(shared.page, () => app.publishButton.click());
    expect(said).toBe("Please enter your name before submitting.");

    // The refusal happens before anything is written, not after a partial save.
    await expect
      .poll(async () => (await data.listEvaluations(member.id)).length)
      .toBe(0);
  });

  test("each submission from a peer is a version of its own", async ({
    data,
    shared,
  }) => {
    const member = await seedMember(data, uniqueName("E2E PeerTwice"));
    const author = uniqueName("Ada");

    const first = await openPeerLink(shared.page, member.peer_token);
    await shared.page.getByTestId("assessment-author").fill(author);
    await first.setLevel(TEAM, 2);
    await first.publishMember();

    await expect
      .poll(async () => (await data.listEvaluations(member.id)).length)
      .toBe(1);

    // Sending replaces the form with a thank you, so there is no half finished
    // review left on screen to come back to.
    await expect(first.page.getByTestId("page-message")).toHaveAttribute(
      "data-kind",
      "thanks",
    );

    // A second opinion is opt in, and it arrives on a blank form: there is
    // nothing to edit, so it becomes a version of its own.
    await first.page.getByTestId("peer-another").click();
    const second = await openPeerLink(shared.page, member.peer_token);
    expect(await second.levelIsSelected(TEAM, 2)).toBe(false);
    await shared.page.getByTestId("assessment-author").fill(author);
    await second.setLevel(TEAM, 5);
    await second.publishMember();

    await expect
      .poll(async () => (await data.listEvaluations(member.id)).length)
      .toBe(2);
    const peers = (await data.listEvaluations(member.id)).filter(
      (evaluation) => evaluation.kind === "peer",
    );
    expect(peers.map((p) => p.current_levels)).toEqual(
      expect.arrayContaining([{ [TEAM]: 2 }, { [TEAM]: 5 }]),
    );
    // Both are still drafts: nothing a peer sends is public on its own.
    expect(peers.map((p) => p.status)).toEqual(["draft", "draft"]);
  });

  test("the two review links stay apart, and neither is the view link", async ({
    data,
    shared,
  }) => {
    const member = await seedMember(data, uniqueName("E2E PeerTokens"));
    const app = new LaddersApp(shared.page);

    // The self link is about the person's own levels, so it asks who they are and
    // never for a name to sign the review with.
    await app.goto(`/#/e/${member.self_token}`);
    await expect(app.page.getByTestId("assessment-name")).toBeVisible();
    await expect(app.page.getByTestId("assessment-author")).toHaveCount(0);

    // The peer link asks for the reviewer's name instead.
    await app.goto(`/#/e/${member.peer_token}`);
    await expect(app.page.getByTestId("assessment-author")).toBeVisible();

    // Neither of them is the read only view: that is a third, separate link.
    await app.goto(`/#/v/${member.peer_token}`);
    await expect(app.page.getByTestId("page-message")).toHaveAttribute(
      "data-kind",
      "notFound",
    );
  });

  test("a peer submission reaches the manager as a draft they can publish or delete", async ({
    data,
    page,
    shared,
  }) => {
    const memberName = uniqueName("E2E PeerHandoff");
    const member = await seedMember(data, memberName);
    const author = uniqueName("Ada");

    const peerApp = await openPeerLink(shared.page, member.peer_token);
    await shared.page.getByTestId("assessment-author").fill(author);
    await peerApp.setLevel(TEAM, 4);
    await peerApp.publishMember();

    await expect
      .poll(async () => (await data.listEvaluations(member.id)).length)
      .toBe(1);

    const managerApp = new LaddersApp(page);
    await managerApp.gotoHome();
    await managerApp.openTeamMember(memberName);

    const row = managerApp.page.getByTestId("version-row").filter({
      hasText: `Peer · ${author}`,
    });
    await expect(row.getByTestId("version-status")).toHaveAttribute(
      "data-status",
      "draft",
    );
    // The decision is the manager's: publish it, or throw it away.
    await expect(row.getByTestId("version-publish")).toBeVisible();
    await expect(row.getByTestId("version-delete")).toBeVisible();
  });
});
