import { test, expect } from "@playwright/test";
import { api, createWorkspace, removeWorkspace, signIn } from "../planner/planner-helpers";
import { expectPublicLayout } from "../shared/public-layout";

test("public catalog and release detail reuse anonymous mobile layout and retain filter URLs", async ({ browser }) => {
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Shiplog layout ${Date.now()}`);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const apps: { id: string; name: string }[] = [];
    for (const name of ["Website", "Mobile"]) {
      const app = await api<{ id: string; name: string }>(owner, "rpc/shiplog_save_application", {
        method: "POST", body: JSON.stringify({ workspace: workspace.id, application_name: name, application_description: "", team: null }),
      });
      apps.push(app);
      await api(owner, "rpc/shiplog_create_release", {
        method: "POST", body: JSON.stringify({ input: { application_id: app.id, version: "1.0.0", title: `${name} launch`, public_notes: `${name} public notes` } }),
      });
    }
    const token = await api<string>(owner, "rpc/shiplog_portal", {
      method: "POST", body: JSON.stringify({ workspace: workspace.id, enabled: true }),
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:5178/#/public/${token}/releases`);
    await expect(page.getByRole("article")).toHaveCount(2);
    await expectPublicLayout(page);
    await page.getByRole("combobox", { name: "Filter by application", exact: true }).click();
    await page.getByRole("option", { name: "Website", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`application=${apps[0]!.id}`));
    await page.reload();
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByRole("link", { name: /Website launch/ }).click();
    await expect(page.getByText("Website public notes", { exact: true })).toBeVisible();
    await expectPublicLayout(page);
  } finally {
    await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
