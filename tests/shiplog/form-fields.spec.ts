import { test, expect } from "@playwright/test";
import { authenticatedPage, createWorkspace, removeWorkspace, selectWorkspace, signIn } from "../planner/planner-helpers";

test("shared Shiplog fields preserve application and release notes", async ({ browser }) => {
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Shared fields ${Date.now()}`);
  const { page, context } = await authenticatedPage(browser, owner, "http://127.0.0.1:5178");
  try {
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Applications", exact: true }).click();
    await page.getByRole("button", { name: "New application", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator('[data-slot="form-field"]')).toHaveCount(3);
    await dialog.getByLabel("Name", { exact: true }).fill("Website");
    await dialog.getByLabel("Description", { exact: true }).fill("App details");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("link", { name: "Releases", exact: true }).click();
    await page.getByRole("button", { name: "New release", exact: true }).click();
    await dialog.getByLabel("Version", { exact: true }).fill("1.0.0");
    await dialog.getByLabel("Title", { exact: true }).fill("Launch");
    const notes = dialog.getByLabel("Public release notes", { exact: true });
    await expect(notes).toHaveAttribute("data-slot", "textarea");
    await notes.fill("Published changes");
    await dialog.getByRole("combobox", { name: "Release status", exact: true }).click();
    await page.getByRole("option", { name: "QA", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await page.getByRole("button", { name: /1\.0\.0.*Launch/ }).click();
    await expect(page.getByLabel("Public release notes", { exact: true })).toHaveValue("Published changes");
    await expect(page.getByLabel("Version", { exact: true })).toBeDisabled();
  } finally {
    await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
