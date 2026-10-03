import type { LaddersData } from "../../scripts/ladders-data";
import { expect, test } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";
import { seedMember } from "./fixtures";

/**
 * Who is allowed to see which version.
 *
 * The rule lives in one database function, public_view, and every one of these
 * tests is about that function: it returns a self version whatever its status
 * and any other version only once it is published. The tests read the version
 * list rather than the radar, because the radar only ever draws the selection.
 */

const TEAM = "Technology";
const OTHER_TEAM = "People";

/** A member whose view link is open, with nothing written on it yet. */
async function memberWithOpenView(data: LaddersData) {
  const member = await seedMember(data, uniqueName("E2E ViewScope"));
  await data.setViewEnabled(member.id, true);
  return member;
}

/** The shared read only link: one viewer holding the whole history. */
async function openViewLink(
  page: import("@playwright/test").Page,
  viewToken: string,
) {
  const app = new LaddersApp(page);
  await app.goto(`/#/v/${viewToken}`);
  await expect(app.page.getByTestId("evaluation-viewer")).toBeVisible();
  return app;
}

/** The manager's own screen for a member, where the history sits in a side panel. */
async function openMemberAssessment(
  page: import("@playwright/test").Page,
  memberId: string,
) {
  const app = new LaddersApp(page);
  await app.goto(`/#/member/${memberId}`);
  await expect(app.page.getByTestId("version-panel")).toBeVisible();
  return app;
}

/**
 * Leaves a self version in draft through the self link.
 *
 * The database refuses a self version written directly, so the only way to have
 * one is the flow the person actually uses: open the link, move a level and let
 * the autosave write the draft.
 */
async function leaveSelfDraft(
  page: import("@playwright/test").Page,
  selfToken: string,
  vertical: string,
  level: number,
): Promise<void> {
  const app = new LaddersApp(page);
  await app.goto(`/#/e/${selfToken}`);
  await expect(app.page.getByTestId("assessment-name")).toBeVisible();
  await app.setLevel(vertical, level);
  await app.waitForAutosave();
}

/**
 * The versions on screen as a sorted list, so an assertion is about which
 * versions are there and not about the order the panel happens to list them in.
 */
function summary(listed: { author: string; status: string }[]): string[] {
  return listed.map((version) => `${version.author}: ${version.status}`).sort();
}

test.describe("Ladders review visibility @visibility", () => {
  test("a manager draft is not on the view link", async ({ data, shared }) => {
    const member = await memberWithOpenView(data);
    await data.createEvaluation(member.id, {
      kind: "manager",
      currentLevels: { [TEAM]: 2 },
      comments: { [TEAM]: "Not ready to share" },
    });

    const app = await openViewLink(shared.page, member.view_token);

    expect(summary(await app.listedVersions())).toEqual([]);
  });

  test("a published manager version is on the view link", async ({
    data,
    shared,
  }) => {
    const member = await memberWithOpenView(data);
    await data.createEvaluation(member.id, {
      kind: "manager",
      status: "published",
      currentLevels: { [TEAM]: 2 },
      goalLevels: { [TEAM]: 3 },
    });

    const app = await openViewLink(shared.page, member.view_token);

    expect(summary(await app.listedVersions())).toEqual(["Manager: published"]);
  });

  test("an unsubmitted peer draft stays with the manager who received it", async ({
    data,
    shared,
    page,
  }) => {
    const member = await memberWithOpenView(data);
    await data.createEvaluation(member.id, {
      kind: "manager",
      status: "published",
      currentLevels: { [TEAM]: 2 },
    });
    const peerName = uniqueName("E2E PeerDraft");
    await data.createEvaluation(member.id, {
      kind: "peer",
      authorName: peerName,
      currentLevels: { [TEAM]: 4 },
    });

    // The manager sees the draft in their own screen, so the draft exists.
    const managerApp = await openMemberAssessment(page, member.id);
    expect(summary(await managerApp.listedVersions())).toContain(
      `Peer · ${peerName}: draft`,
    );

    // The shared link does not.
    const sharedApp = await openViewLink(shared.page, member.view_token);
    expect(summary(await sharedApp.listedVersions())).toEqual([
      "Manager: published",
    ]);
  });

  test("a published peer review reaches the link with the name its author typed", async ({
    data,
    shared,
  }) => {
    const member = await memberWithOpenView(data);
    const peerName = uniqueName("E2E PeerDone");
    await data.createEvaluation(member.id, {
      kind: "peer",
      status: "published",
      authorName: peerName,
      currentLevels: { [OTHER_TEAM]: 3 },
    });

    const app = await openViewLink(shared.page, member.view_token);

    expect(summary(await app.listedVersions())).toEqual([
      `Peer · ${peerName}: published`,
    ]);
  });

  test("the person evaluated sees their own draft, because it is theirs", async ({
    data,
    shared,
  }) => {
    const member = await memberWithOpenView(data);
    await data.createEvaluation(member.id, {
      kind: "manager",
      status: "published",
      currentLevels: { [TEAM]: 2 },
    });
    await leaveSelfDraft(shared.page, member.self_token, TEAM, 3);

    const app = await openViewLink(shared.page, member.view_token);

    // The self draft is the only draft a shared link ever shows.
    expect(summary(await app.listedVersions())).toEqual([
      "Manager: published",
      "Self: draft",
    ]);
  });

  test("the link shows every published version and only the self drafts", async ({
    data,
    shared,
  }) => {
    const member = await memberWithOpenView(data);
    await data.createEvaluation(member.id, {
      kind: "manager",
      status: "published",
      currentLevels: { [TEAM]: 1 },
    });
    await data.createEvaluation(member.id, {
      kind: "manager",
      status: "published",
      currentLevels: { [TEAM]: 2 },
    });
    await data.createEvaluation(member.id, {
      kind: "peer",
      authorName: uniqueName("E2E PeerMany"),
      currentLevels: { [TEAM]: 3 },
    });
    await leaveSelfDraft(shared.page, member.self_token, TEAM, 4);

    const app = await openViewLink(shared.page, member.view_token);

    const listed = await app.listedVersions();
    expect(listed.filter((v) => v.author === "Manager")).toHaveLength(2);
    expect(summary(listed.filter((v) => v.status === "draft"))).toEqual([
      "Self: draft",
    ]);
  });

  test("a draft written after the link was opened never reaches the view list", async ({
    data,
    shared,
  }) => {
    const member = await memberWithOpenView(data);
    await data.createEvaluation(member.id, {
      kind: "manager",
      status: "published",
      currentLevels: { [TEAM]: 2 },
    });

    const app = await openViewLink(shared.page, member.view_token);
    expect(await app.listedVersions()).toHaveLength(1);

    // A second manager version starts as a draft and stays out of the list, which
    // is what the earlier assertion has to keep meaning after the page is loaded.
    await data.createEvaluation(member.id, {
      kind: "manager",
      currentLevels: { [TEAM]: 5 },
    });
    await data.updateEvaluationStatus(
      (await data.listEvaluations(member.id))[0].id,
      "published",
    );
    await app.page.reload();
    await expect(app.page.getByTestId("evaluation-viewer")).toBeVisible();

    expect(summary(await app.listedVersions())).toEqual([
      "Manager: published",
      "Manager: published",
    ]);
  });
});
