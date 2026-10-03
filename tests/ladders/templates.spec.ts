import { expect, seedMember, test } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";

/**
 * The seniority template a member is measured against.
 *
 * Choosing a template changes what the levels mean, so the interesting part is
 * not that a value lands in a column but that the levels move with it: D3 puts
 * Technology at L2 and D7 puts it at L5, and the member sees the same numbers the
 * manager chose.
 */

const PANEL = "template-panel";

/** Picks a template from the manager's select and waits for it to be stored. */
async function chooseTemplate(
  app: LaddersApp,
  data: import("../../scripts/ladders-data").LaddersData,
  memberId: string,
  templateId: string,
): Promise<void> {
  await app.page.locator("#template-select").selectOption(templateId);
  await expect
    .poll(async () => (await data.member(memberId))?.template_id)
    .toBe(templateId);
}

/** Expands the explanation and reads back what it says each vertical expects. */
async function explainedLevels(app: LaddersApp): Promise<string[]> {
  const toggle = app.page.getByRole("button", {
    name: "What this level means",
  });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  return app.page.getByTestId(PANEL).locator("li").allInnerTexts();
}

const saysLevel = (levels: string[], vertical: string, level: number) =>
  expect(levels).toEqual(
    expect.arrayContaining([
      expect.stringContaining(`${vertical} · L${level} `),
    ]),
  );

test.describe("Ladders seniority templates @templates", () => {
  test("a chosen template is stored on the member", async ({ data, page }) => {
    const member = await seedMember(data, uniqueName("E2E TemplatePick"));

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);
    await app.page.getByTestId(PANEL).waitFor();
    await chooseTemplate(app, data, member.id, "D3");

    await expect(page.getByTestId(PANEL)).toContainText(
      "Go-to person for some technologies",
    );
  });

  test("the templates are offered grouped by track", async ({ data, page }) => {
    const member = await seedMember(data, uniqueName("E2E TemplateTracks"));

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);
    const select = page.locator("#template-select");

    await expect(select.locator("optgroup[label='Developer']")).toHaveCount(1);
    await expect(select.locator("optgroup[label='Tech Lead']")).toHaveCount(1);
    await expect(
      select.locator("optgroup[label='Engineering Manager']"),
    ).toHaveCount(1);
    // No template is a real choice, and it is the one a new member starts on.
    await expect(select.locator("option[value='']")).toHaveText("No template");
  });

  test("a different template explains different levels for the same person", async ({
    data,
    page,
  }) => {
    const member = await seedMember(data, uniqueName("E2E TemplateSwaps"));

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);
    await app.page.getByTestId(PANEL).waitFor();

    await chooseTemplate(app, data, member.id, "D3");
    const asD3 = await explainedLevels(app);
    saysLevel(asD3, "Technology", 2);
    saysLevel(asD3, "Process", 3);

    await chooseTemplate(app, data, member.id, "D7");
    const asD7 = await explainedLevels(app);
    saysLevel(asD7, "Technology", 5);
    saysLevel(asD7, "Process", 4);
    // The level that never moves across the developer track is worth naming, so
    // that a swap that silently rewrites People is caught here rather than later.
    saysLevel(asD7, "People", 3);
  });

  test("clearing the template leaves the member without one", async ({
    data,
    page,
  }) => {
    const member = await seedMember(data, uniqueName("E2E TemplateNone"));

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);
    await app.page.getByTestId(PANEL).waitFor();
    await chooseTemplate(app, data, member.id, "TL5");
    await expect(page.getByTestId(PANEL)).toContainText("Tech Lead");
    await expect(
      page.getByRole("button", { name: "What this level means" }),
    ).toBeVisible();

    await app.page.locator("#template-select").selectOption("");

    await expect
      .poll(async () => (await data.member(member.id))?.template_id)
      .toBeNull();
    // With nothing chosen there is nothing left to explain.
    await expect(page.getByTestId(PANEL)).not.toContainText(
      "What this level means",
    );
  });

  test("the person being assessed sees the template the manager chose", async ({
    data,
    page,
  }) => {
    const member = await seedMember(data, uniqueName("E2E TemplateSeen"));
    await data.setTemplate(member.id, "EM6");
    await data.setViewEnabled(member.id, true);

    const app = new LaddersApp(page);
    await app.goto(`/#/v/${member.view_token}`);

    // The view page shows the template as plain text: the person can read what
    // they are measured against but cannot move it.
    const panel = page.getByTestId(PANEL);
    await expect(panel).toContainText("EM6");
    await expect(panel).toContainText("Engineering Manager");
    await expect(panel.locator("select")).toHaveCount(0);
  });
});
