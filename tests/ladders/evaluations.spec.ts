import { test, expect, seedMember } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";

/**
 * The three ways an evaluation is filled in: by the manager, by the evaluated
 * person through their self link, and by a peer through the peer link. The two
 * link flows run in a signed out context because that is how they are really
 * used, and it doubles as proof that EntryGate lets those routes through.
 */
test.describe("Ladders evaluations @evaluations", () => {
  test("the manager publishes an evaluation for a member", async ({
    page,
    data,
  }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E Managed");

    const member = await seedMember(data, memberName);

    await app.gotoHome();
    await app.openTeamMember(memberName);
    await app.setLevel("Technology", 3);
    await app.publishMember();

    await expect
      .poll(async () =>
        (await data.listEvaluations(member.id)).map((e) => e.status),
      )
      .toContain("published");

    const evaluation = (await data.listEvaluations(member.id))[0];
    expect(evaluation.kind).toBe("manager");
    expect(evaluation.current_levels).toMatchObject({ Technology: 3 });
  });

  test("a peer submits a draft that the manager then publishes", async ({
    page,
    data,
    shared,
  }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E Peer");
    const author = uniqueName("Ada");

    const member = await seedMember(data, memberName);

    await shared.open(`/#/e/${member.peer_token}`);
    await expect(shared.page.getByTestId("assessment-author")).toBeVisible();
    await expect(shared.page.getByTestId("assessment-header")).toBeVisible();

    await shared.page.getByTestId("assessment-author").fill(author);
    await shared.app.setLevel("Technology", 4);
    await shared.app.publishButton.click();

    // peer_submit always lands as a draft: the manager decides what is public.
    await expect
      .poll(async () =>
        (await data.listEvaluations(member.id)).map((e) => e.kind),
      )
      .toContain("peer");

    const peer = (await data.listEvaluations(member.id)).find(
      (e) => e.kind === "peer",
    );
    expect(peer?.status).toBe("draft");
    expect(peer?.current_levels).toMatchObject({ Technology: 4 });
    expect(peer?.author_name).toBe(author);

    await app.gotoHome();
    await app.openTeamMember(memberName);
    const version = page
      .getByTestId("version-panel")
      .getByTestId("version-publish");
    await expect(version).toHaveAttribute("data-status", "draft");
    await version.click();

    await expect
      .poll(
        async () =>
          (await data.listEvaluations(member.id)).find((e) => e.kind === "peer")
            ?.status,
      )
      .toBe("published");
  });

  test("the evaluated person fills in their own evaluation through the self link", async ({
    data,
    shared,
  }) => {
    const memberName = uniqueName("E2E Self");
    const member = await seedMember(data, memberName);

    await shared.open(`/#/e/${member.self_token}`);

    // The self link is about levels only: the profile is owned by the manager.
    await expect(shared.page.getByTestId("assessment-name")).toHaveAttribute(
      "readonly",
      "",
    );
    await expect(shared.page.getByTestId("assessment-author")).toHaveCount(0);

    await shared.app.setLevel("Technology", 2);
    await shared.app.publishButton.click();

    await expect
      .poll(async () =>
        (await data.listEvaluations(member.id)).map((e) => e.kind),
      )
      .toContain("self");

    const self = (await data.listEvaluations(member.id)).find(
      (e) => e.kind === "self",
    );
    expect(self?.status).toBe("published");
  });

  test("the view link stays closed until it is enabled, then opens read only", async ({
    page,
    data,
    shared,
  }) => {
    const app = new LaddersApp(page);
    const memberName = uniqueName("E2E View");

    const member = await seedMember(data, memberName);

    await shared.open(`/#/v/${member.view_token}`);
    await expect(shared.page.getByTestId("page-message")).toHaveAttribute(
      "data-kind",
      "notFound",
    );

    await data.setViewEnabled(member.id, true);

    await shared.open(`/#/v/${member.view_token}`);
    await expect(shared.page.getByTestId("page-message")).toHaveCount(0);
    await expect(shared.page.getByText(memberName).first()).toBeVisible();
    // Read only: nothing on this page can change the evaluation.
    await expect(shared.app.publishButton).toHaveCount(0);
  });

  test("an unknown token is rejected", async ({ shared }) => {
    await shared.open("/#/e/11111111-1111-4111-8111-111111111111");
    await expect(shared.page.getByTestId("page-message")).toHaveAttribute(
      "data-kind",
      "notFound",
    );
  });

  test("a malformed token never reaches the network", async ({ shared }) => {
    await shared.open("/#/v/not-a-uuid");
    await expect(shared.page.getByTestId("page-message")).toHaveAttribute(
      "data-kind",
      "notFound",
    );
  });
});
