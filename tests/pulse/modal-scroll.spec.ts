import { test } from "@playwright/test";
import { createWorkspace, openPulse, removeWorkspace, selectWorkspace, signIn } from "./pulse-helpers";
import { expectSingleModalScroll } from "../helpers/modal-scroll";

test("Pulse action, survey, answer and retrospective modals use one scroll owner", async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Modal scroll ${Date.now()}`);
  const { page, context } = await openPulse(browser, owner);
  try {
    await selectWorkspace(page, workspace.name);
    const nav = page.getByRole("navigation", { name: "Pulse pages" });
    await nav.getByRole("link", { name: "Actions", exact: true }).click();
    await page.getByRole("button", { name: "New action", exact: true }).click();
    await expectSingleModalScroll(page, page.getByRole("dialog"), "Create action");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await nav.getByRole("link", { name: "Team Pulse", exact: true }).click();
    await page.getByRole("button", { name: "New survey", exact: true }).click();
    await expectSingleModalScroll(page, page.getByRole("dialog"), "Create survey");
    await page.getByRole("dialog").getByLabel("Title", { exact: true }).fill("Scroll survey");
    await page.getByRole("dialog").getByRole("button", { name: "Create survey", exact: true }).click();
    await page.getByRole("button", { name: "Answer", exact: true }).click();
    await expectSingleModalScroll(page, page.getByRole("dialog"), "Send answer");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await nav.getByRole("link", { name: "Retrospectives", exact: true }).click();
    await page.getByRole("button", { name: "New retrospective", exact: true }).click();
    await expectSingleModalScroll(page, page.getByRole("dialog"), "Create retrospective");
  } finally {
    await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
