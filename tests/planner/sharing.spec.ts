import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  addFeatures, api, authenticatedPage, createRoster, createWorkspace, removeWorkspace, selectWorkspace, signIn,
  waitForWorkspace, type Account,
} from "./planner-helpers";

const workspaceButton = (page: Page) => page.getByRole("button", { name: "Workspace", exact: true });
async function reopen(page: Page, workspace: string) {
  await page.reload();
  await selectWorkspace(page, workspace);
}

test.describe("Planner workspace sharing", () => {
  let owner: Account;
  const contexts: BrowserContext[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  test.beforeEach(async () => { owner = await signIn(); });
  test.afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  test("the owner shares a workspace by email and changes or revokes its access", async ({ browser }) => {
    test.setTimeout(120_000);
    const collaborator = await signIn(true);
    const workspace = await createWorkspace(owner);
    cleanup.push(() => removeWorkspace(owner, workspace.id));
    await createRoster(owner, `Shared ${randomUUID().slice(0, 8)}`, undefined, workspace.id);
    await addFeatures(owner, workspace.id, [{ name: "Checkout", backend_devs: 1, backend_weeks: 1 }]);

    const ownerPage = (await authenticatedPage(browser, owner)).page;
    contexts.push(ownerPage.context());
    await selectWorkspace(ownerPage, workspace.name);
    await expect(workspaceButton(ownerPage)).toContainText("Owner");
    // The shared WorkspaceBar dialog shares per app and preselects Planner.
    await ownerPage.getByTestId("workspace-share").click();
    const dialog = ownerPage.getByRole("alertdialog", { name: `Share ${workspace.name}` });
    await expect(dialog).toContainText("Not shared with anyone yet.");
    await dialog.getByLabel("Email", { exact: true }).fill(collaborator.user.email);
    await expect(dialog.getByTestId("share-app-select")).toHaveValue("planner");
    await expect(dialog.getByLabel("Permission", { exact: true })).toHaveValue("viewer");
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    const permission = dialog.getByLabel(`Planner access for ${collaborator.user.email}`, { exact: true });
    await expect(permission).toHaveValue("viewer");
    await expect(dialog.getByLabel(`Ladders access for ${collaborator.user.email}`, { exact: true })).toHaveValue("");
    await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue("");

    // A viewer reads every page but gets no editing controls.
    const viewer = (await authenticatedPage(browser, collaborator)).page;
    contexts.push(viewer.context());
    await selectWorkspace(viewer, workspace.name);
    await expect(workspaceButton(viewer)).toContainText("Viewer");
    await expect(viewer.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
    await expect(viewer.getByRole("article", { name: "Checkout", exact: true })).toBeVisible();
    await expect(viewer.getByText("Workspace owners and editors manage feature estimates and priorities.")).toBeVisible();
    await expect(viewer.getByRole("button", { name: "New feature", exact: true })).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: "Edit Checkout", exact: true })).toHaveCount(0);
    await viewer.getByRole("link", { name: "Roadmap", exact: true }).click();
    await expect(viewer.getByLabel("Schedule row: Checkout", { exact: true })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Add feature", exact: true })).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: "Edit plan start", exact: true })).toHaveCount(0);
    await viewer.getByRole("link", { name: "Vacations", exact: true }).click();
    await expect(viewer.getByRole("region", { name: "Squad velocity", exact: true })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Calibrate velocity", exact: true })).toHaveCount(0);

    await permission.selectOption("editor");
    await expect.poll(async () => (await api<{ access_level: string }[]>(owner, "rpc/list_workspace_shares", {
      method: "POST", body: JSON.stringify({ workspace: workspace.id }),
    }))?.map(share => share.access_level)).toEqual(["editor"]);
    await viewer.getByRole("link", { name: "Estimation", exact: true }).click();
    await reopen(viewer, workspace.name);
    await expect(workspaceButton(viewer)).toContainText("Editor");
    await expect(viewer.getByRole("button", { name: "New feature", exact: true })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Edit Checkout", exact: true })).toBeVisible();
    // Editors change the plan but never its sharing.
    await expect(viewer.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);

    await dialog.getByRole("button", { name: `Remove ${collaborator.user.email}`, exact: true }).click();
    await expect(dialog).toContainText("Not shared with anyone yet.");
    await viewer.reload();
    await waitForWorkspace(viewer);
    await workspaceButton(viewer).click();
    await expect(viewer.getByRole("menuitemradio", { name: workspace.name, exact: true })).toHaveCount(0);
  });

  test("a share for another app does not open the workspace in Planner", async ({ browser }) => {
    test.setTimeout(90_000);
    const collaborator = await signIn(true);
    const workspace = await createWorkspace(owner);
    cleanup.push(() => removeWorkspace(owner, workspace.id));
    const ownerPage = (await authenticatedPage(browser, owner)).page;
    contexts.push(ownerPage.context());
    await selectWorkspace(ownerPage, workspace.name);
    await ownerPage.getByTestId("workspace-share").click();
    const dialog = ownerPage.getByRole("alertdialog", { name: `Share ${workspace.name}` });
    await dialog.getByLabel("Email", { exact: true }).fill(collaborator.user.email);
    await dialog.getByTestId("share-app-select").selectOption("ladders");
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByLabel(`Ladders access for ${collaborator.user.email}`, { exact: true })).toHaveValue("viewer");
    await expect(dialog.getByLabel(`Planner access for ${collaborator.user.email}`, { exact: true })).toHaveValue("");

    const other = (await authenticatedPage(browser, collaborator)).page;
    contexts.push(other.context());
    await waitForWorkspace(other);
    await workspaceButton(other).click();
    await expect(other.getByRole("menuitem", { name: "New workspace", exact: true })).toBeVisible();
    await expect(other.getByRole("menuitemradio", { name: workspace.name, exact: true })).toHaveCount(0);
  });

  test("the workspace menu creates a workspace and switches to it", async ({ browser }) => {
    const name = `Created ${randomUUID().slice(0, 8)}`;
    cleanup.push(() => api(owner, `workspaces?name=eq.${encodeURIComponent(name)}&created_for_team=is.false`, { method: "DELETE" }));
    const { page, context } = await authenticatedPage(browser, owner);
    contexts.push(context);
    await waitForWorkspace(page);
    // Read the title first: an open menu hides the rest of the page from the accessibility tree.
    const current = await workspaceButton(page).getAttribute("title");
    await workspaceButton(page).click();
    await page.getByRole("menuitem", { name: "New workspace", exact: true }).click();
    const create = page.getByRole("alertdialog", { name: "New workspace" });
    // Cancelling keeps the current workspace.
    await create.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(create).toHaveCount(0);
    await expect(workspaceButton(page)).toHaveAttribute("title", current!);
    await workspaceButton(page).click();
    await page.getByRole("menuitem", { name: "New workspace", exact: true }).click();
    await create.getByLabel("Name", { exact: true }).fill(name);
    await create.getByRole("button", { name: "Create", exact: true }).click();
    await expect(create).toHaveCount(0);
    await waitForWorkspace(page);
    await expect(workspaceButton(page)).toHaveAttribute("title", name);
    await expect(workspaceButton(page)).toContainText("Owner");
    await expect(page.getByRole("heading", { name: "No features yet" })).toBeVisible();
    await workspaceButton(page).click();
    await expect(page.getByRole("menuitemradio", { name, exact: true })).toHaveAttribute("aria-checked", "true");
  });
});
