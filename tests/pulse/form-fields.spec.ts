import { test, expect } from "@playwright/test";
import { api, createWorkspace, openPulse, removeWorkspace, selectWorkspace, signIn } from "./pulse-helpers";

test("shared Pulse fields preserve action, survey comment and retrospective data", async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Shared fields ${Date.now()}`);
  const { page, context } = await openPulse(browser, owner);
  try {
    await selectWorkspace(page, workspace.name);
    const nav = page.getByRole("navigation", { name: "Pulse pages" });
    await nav.getByRole("link", { name: "Actions", exact: true }).click();
    await page.getByRole("button", { name: "New action", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator('[data-slot="form-field"]')).toHaveCount(6);
    await dialog.getByLabel("Action", { exact: true }).fill("Shared action");
    await dialog.getByLabel("Description", { exact: true }).fill("Action details");
    await dialog.getByRole("combobox", { name: "Owner", exact: true }).click();
    await page.getByRole("option", { name: owner.user.email, exact: true }).click();
    await dialog.getByRole("button", { name: "Create action", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    const action = page.getByRole("article", { name: "Shared action", exact: true });
    await expect(action).toContainText("Action details");
    await page.getByRole("combobox", { name: "Status", exact: true }).click();
    await page.getByRole("option", { name: "All statuses", exact: true }).click();
    await action.getByRole("combobox", { name: "Status of “Shared action”", exact: true }).click();
    await page.getByRole("option", { name: "Done", exact: true }).click();
    await action.getByRole("button", { name: "Record outcome", exact: true }).click();
    await action.getByLabel("Outcome", { exact: true }).fill("Outcome details");
    await action.getByRole("button", { name: "Save outcome", exact: true }).click();
    await expect(action.getByText("Outcome details", { exact: true })).toBeVisible();

    await nav.getByRole("link", { name: "Team Pulse", exact: true }).click();
    await page.getByRole("button", { name: "New survey", exact: true }).click();
    await dialog.getByLabel("Title", { exact: true }).fill("Shared survey");
    await expect(dialog.getByLabel("Minimum responses", { exact: true })).toHaveAttribute("aria-describedby", /-description$/);
    await dialog.getByRole("button", { name: "Create survey", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Answer", exact: true }).click();
    const comment = dialog.locator('[data-slot="textarea"]');
    await expect(comment).toHaveAttribute("aria-describedby", /-description$/);
    await comment.fill("Survey comment");
    for (const group of await dialog.getByRole("radiogroup").all()) {
      await group.getByRole("radio").first().check({ force: true });
    }
    const sent = page.waitForResponse((response) => response.url().includes("/rpc/submit_pulse_response"));
    await dialog.getByRole("button", { name: "Send answer", exact: true }).click();
    const response = await sent;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON().comment).toBe("Survey comment");
    await expect(dialog).toBeHidden();

    await nav.getByRole("link", { name: "Retrospectives", exact: true }).click();
    await page.getByRole("button", { name: "New retrospective", exact: true }).click();
    await dialog.getByLabel("Title", { exact: true }).fill("Shared retro");
    await dialog.locator('[data-slot="textarea"]').fill("Retro goal");
    await dialog.getByRole("button", { name: "Create retrospective", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    expect(await api(owner, `pulse_retros?workspace_id=eq.${workspace.id}&select=goal`)).toEqual([{ goal: "Retro goal" }]);
    await page.getByRole("button", { name: "Start Collect", exact: true }).click();
    await page.getByLabel("New topic in Went well", { exact: true }).fill("Shared topic");
    await page.getByLabel("Details for the new topic in Went well", { exact: true }).fill("Topic details");
    await page.getByRole("region", { name: "Went well", exact: true }).getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Topic details", { exact: true })).toBeVisible();
    for (const stage of ["Group", "Vote", "Discuss"]) {
      await page.getByRole("button", { name: `Start ${stage}`, exact: true }).click();
    }
    await page.getByRole("button", { name: "Take notes on Shared topic", exact: true }).click();
    await page.getByLabel("Root causes", { exact: true }).fill("Discussion details");
    await page.getByRole("button", { name: "Save notes", exact: true }).click();
    await expect(page.getByLabel("Root causes", { exact: true })).toBeHidden();
    await expect(page.getByText("Discussion details", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Discussion details", { exact: true })).toBeVisible();
  } finally {
    await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
