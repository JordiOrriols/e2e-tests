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
  let featureId: string | undefined;
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
    await page.route("**/rest/v1/rpc/delete_workspace", async (route) => {
      const target = route.request().postDataJSON()?.workspace;
      if (!created || target !== created.id)
        throw new Error(
          "Deletion must target only this test's empty workspace",
        );
      const response = await route.fetch();
      if (response.ok()) created = undefined;
      await route.fulfill({ response });
    });
    await page.reload();
    const setup = page.getByTestId("workspace-setup");
    await expect(setup).toBeVisible();
    await setup.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByTestId("team-name-input").fill(name);
    await page.getByTestId("team-name-submit").click();
    const switcher = page.getByTestId("workspace-switcher");
    await expect(switcher).toHaveAttribute("title", name);
    if (!created) throw new Error("The workspace was not created");
    const id = created.id;
    await api(account, "rpc/create_team", {
      method: "POST",
      body: JSON.stringify({ p_name: "Empty E2E team", p_workspace: id }),
    });
    const projects = await api<{ id: string }[]>(account, "projects", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ workspace_id: id, name: "E2E project" }),
    });
    if (!projects?.[0]) throw new Error("The test project was not created");
    const features = await api<{ id: string }[]>(account, "features", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        project_id: projects[0].id,
        name: "Content prevents deletion",
      }),
    });
    if (!features?.[0]) throw new Error("The test feature was not created");
    featureId = features[0].id;
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
    await api(account, `features?id=eq.${featureId}`, { method: "DELETE" });
    featureId = undefined;
    await switcher.click();
    await page.getByRole("menuitem", { name: "Delete workspace" }).click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(setup).toBeVisible();
    expect(created).toBeUndefined();
    expect(await api(account, `workspaces?id=eq.${id}&select=id`)).toEqual([]);
  } finally {
    await context.close();
    if (featureId)
      await api(account, `features?id=eq.${featureId}`, { method: "DELETE" });
    if (created) await removeWorkspace(account, created.id);
  }
});
