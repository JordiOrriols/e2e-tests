import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  api,
  authenticatedPage,
  removeWorkspace,
  signIn,
} from "../planner/planner-helpers";

type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  access_level: string;
};

test("accounts without a workspace can wait and accept an invitation without creating one", async ({
  browser,
  baseURL,
}) => {
  const app = String(test.info().project.metadata["app"]);
  const account = await signIn();
  const accessible = await api<Workspace[]>(account, "rpc/list_workspaces", {
    method: "POST",
    body: JSON.stringify({ app_name: app }),
  });
  if (!accessible?.length)
    throw new Error(`Test account needs an accessible ${app} workspace`);
  const { page, context } = await authenticatedPage(browser, account, baseURL);
  try {
    let invited = false;
    let creations = 0;
    await page.route("**/rest/v1/rpc/list_workspaces", (route) =>
      route.fulfill({ json: invited ? accessible : [] }),
    );
    await page.route("**/rest/v1/rpc/create_workspace", (route) => {
      creations++;
      return route.continue();
    });
    await page.reload();
    const setup = page.getByTestId("workspace-setup");
    await expect(setup).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await setup.getByRole("button", { name: "Wait for an invitation" }).click();
    await expect(setup.getByRole("heading")).toHaveText(
      "Waiting for an invitation",
    );
    expect(creations).toBe(0);
    invited = true;
    await setup.getByRole("button", { name: "Check invitations" }).click();
    await expect(setup).toBeHidden();
    await expect(page.getByTestId("workspace-switcher")).toHaveAttribute(
      "title",
      accessible[0]!.name,
    );
    expect(creations).toBe(0);
  } finally {
    await context.close();
  }
});

test("explicit creation works and deletion confirms, shows rejections, then refreshes", async ({
  browser,
  baseURL,
}) => {
  const account = await signIn();
  const { page, context } = await authenticatedPage(browser, account, baseURL);
  let created: Workspace | undefined;
  const name = `Lifecycle E2E ${randomUUID().slice(0, 8)}`;
  let rejected = true;
  try {
    await page.route("**/rest/v1/rpc/list_workspaces", (route) =>
      route.fulfill({ json: created ? [created] : [] }),
    );
    await page.route("**/rest/v1/rpc/create_workspace", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      created = { ...(await response.json()), access_level: "owner" };
      await route.fulfill({ response });
    });
    // Hosted deployment requires approval; backend tests exercise the real migrated RPC.
    // This browser contract drives its success/error responses without deploying it.
    await page.route("**/rest/v1/rpc/delete_workspace", async (route) => {
      const target = route.request().postDataJSON()?.workspace;
      if (!created || target !== created.id)
        throw new Error(
          "Deletion must target only this test's empty workspace",
        );
      if (rejected) {
        await route.fulfill({
          status: 409,
          json: { code: "23503", message: "Workspace is not empty" },
        });
      } else {
        await removeWorkspace(account, created.id);
        created = undefined;
        await route.fulfill({ json: null });
      }
    });
    await page.reload();
    const setup = page.getByTestId("workspace-setup");
    await expect(setup).toBeVisible();
    await setup.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByTestId("team-name-input").fill(name);
    await page.getByTestId("team-name-submit").click();
    const switcher = page.getByTestId("workspace-switcher");
    await expect(switcher).toHaveAttribute("title", name);
    await switcher.click();
    await page.getByRole("menuitem", { name: "Delete workspace" }).click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await page.getByTestId("confirm-dialog-cancel").click();
    await expect(switcher).toHaveAttribute("title", name);
    await switcher.click();
    await page.getByRole("menuitem", { name: "Delete workspace" }).click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Workspace is not empty" }),
    ).toBeVisible();
    await expect(switcher).toHaveAttribute("title", name);
    rejected = false;
    await switcher.click();
    await page.getByRole("menuitem", { name: "Delete workspace" }).click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(setup).toBeVisible();
    expect(created).toBeUndefined();
  } finally {
    await context.close();
    if (created) await removeWorkspace(account, created.id);
  }
});
