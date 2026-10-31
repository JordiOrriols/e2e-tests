import { test, expect, type BrowserContext } from "@playwright/test";
import { api, authenticatedPage, createWorkspace, removeWorkspace, selectWorkspace, signIn } from "../planner/planner-helpers";
import { expectSingleModalScroll } from "../helpers/modal-scroll";

test("Shiplog application and long checklist modals use one scroll owner", async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Modal scroll ${Date.now()}`);
  let context: BrowserContext | undefined;
  try {
    const opened = await authenticatedPage(browser, owner, "http://127.0.0.1:5178");
    context = opened.context;
    const page = opened.page;
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Applications", exact: true }).click();
    await page.getByRole("button", { name: "New application", exact: true }).click();
    await expectSingleModalScroll(page, page.getByRole("dialog"), "Save");
    await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Website");
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const [application] = (await api<{ id: string }[]>(owner,
      `shiplog_applications?workspace_id=eq.${workspace.id}&select=id`))!;
    await api(owner, "rpc/shiplog_save_checklist_template", {
      method: "POST", body: JSON.stringify({ application: application!.id, expected_revision: 0,
        items: Array.from({ length: 15 }, (_, index) => ({
          title: `Check ${index}`, description: "Detailed QA instructions", category: "QA", mandatory: true,
        })),
      }),
    });
    await page.getByRole("button", { name: "Website checklist template", exact: true }).click();
    await page.getByText("Check 14", { exact: true }).waitFor();
    await expectSingleModalScroll(page, page.getByRole("dialog"), "Save template", true);
    await page.getByRole("button", { name: "Edit checklist item Check 14", exact: true }).click();
    await expectSingleModalScroll(page, page.getByRole("dialog"), "Apply item", true);
  } finally {
    await context?.close();
    await removeWorkspace(owner, workspace.id);
  }
});
