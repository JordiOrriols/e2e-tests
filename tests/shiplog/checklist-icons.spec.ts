import { test, expect } from "@playwright/test";
import { api, authenticatedPage, createWorkspace, removeWorkspace, selectWorkspace, signIn } from "../planner/planner-helpers";
import { expectFooterLayout } from "../shared/app-shell";

test("Shiplog checklist item icons are top-right with shared tooltips and persisted edit/delete behavior", async ({ browser }) => {
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Checklist icons ${Date.now()}`);
  const { page, context } = await authenticatedPage(browser, owner, "http://127.0.0.1:5178");
  try {
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Applications", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole("button", { name: "New application", exact: true })).toBeVisible();
    await expectFooterLayout(page, true);
    await page.getByRole("button", { name: "New application", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Website");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const applications = await api<{ id: string }[]>(owner, `shiplog_applications?workspace_id=eq.${workspace.id}&select=id`);
    const application = applications?.[0];
    if (!application) throw new Error("Test application was not saved");
    await api(owner, "rpc/shiplog_save_checklist_template", {
      method: "POST", body: JSON.stringify({
        application: application.id, expected_revision: 0,
        items: [{ title: "Review", description: "Check release", category: "QA", mandatory: true }],
      }),
    });
    await page.getByRole("button", { name: "Website checklist template", exact: true }).click();
    const edit = page.getByRole("button", { name: "Edit checklist item Review", exact: true });
    const remove = page.getByRole("button", { name: "Remove checklist item Review", exact: true });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect(edit).toBeVisible();
      await expect(edit).toHaveText("");
      await expect(remove).toHaveText("");
      await expect(edit.locator(".lucide-pencil")).toBeVisible();
      await expect(remove.locator(".lucide-trash-2")).toBeVisible();
      const geometry = await edit.evaluate((button) => {
        const item = button.closest("li")!.getBoundingClientRect();
        const rect = button.getBoundingClientRect();
        const title = button.closest("li")!.querySelector("p")!.getBoundingClientRect();
        return { top: rect.top - item.top, right: item.right - rect.right, titleRight: title.right, buttonLeft: rect.left };
      });
      expect(geometry.top).toBeLessThanOrEqual(14);
      expect(geometry.right).toBeLessThanOrEqual(50);
      expect(geometry.buttonLeft).toBeGreaterThanOrEqual(geometry.titleRight);
      await page.getByRole("dialog").getByText("Check release", { exact: true }).click();
      await edit.hover();
      await expect(page.getByRole("tooltip")).toHaveText("Edit checklist item Review");
      await page.getByRole("dialog").getByText("Check release", { exact: true }).hover();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toBeHidden();
      await remove.focus();
      await expect(page.getByRole("tooltip")).toHaveText("Remove checklist item Review");
      await remove.press("Escape");
    }
    await edit.click();
    await page.getByLabel("Title", { exact: true }).fill("Reviewed");
    await page.getByRole("button", { name: "Apply item", exact: true }).click();
    await page.getByRole("button", { name: "Save template", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Checklist template saved.");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Website checklist template", exact: true }).click();
    await page.getByRole("button", { name: "Remove checklist item Reviewed", exact: true }).click();
    await page.getByRole("button", { name: "Save template", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Checklist template saved.");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Website checklist template", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(0);
  } finally {
    await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
