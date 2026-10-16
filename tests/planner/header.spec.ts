import { test, expect } from "@playwright/test";
import { expectProjectSwitcher } from "../shared/app-header";
import { authenticatedPage, signIn, waitForWorkspace } from "./planner-helpers";

test("the shared header names the app Planner, switches projects and keeps tabs and workspace actions apart", async ({ browser }) => {
  const { page, context } = await authenticatedPage(browser, await signIn());
  try {
    await waitForWorkspace(page);
    await expect(page.getByTestId("header-title")).toHaveText("Planner");
    await expect(page.getByText("Cadence", { exact: true })).toHaveCount(0);
    await expectProjectSwitcher(page, "planner");

    const tabs = page.getByRole("navigation", { name: "Planner pages", exact: true });
    await expect(tabs.getByRole("link")).toHaveText(["Estimation", "Roadmap", "Vacations", "Team configuration"]);
    await expect(tabs.getByRole("link", { name: "Estimation", exact: true })).toHaveAttribute("aria-current", "page");
    // Workspace selection and sharing sit in the tab bar, after the tabs.
    const workspace = tabs.getByRole("button", { name: "Workspace", exact: true });
    const share = tabs.getByRole("button", { name: "Share", exact: true });
    const lastTab = await tabs.getByRole("link", { name: "Team configuration", exact: true }).boundingBox();
    const workspaceBox = await workspace.boundingBox();
    const shareBox = await share.boundingBox();
    expect(workspaceBox!.x).toBeGreaterThan(lastTab!.x + lastTab!.width);
    expect(shareBox!.x).toBeGreaterThan(workspaceBox!.x);

    await tabs.getByRole("link", { name: "Roadmap", exact: true }).click();
    await expect(page).toHaveURL(/#\/backlog$/);
    await expect(tabs.getByRole("link", { name: "Roadmap", exact: true })).toHaveAttribute("aria-current", "page");
  } finally {
    await context.close();
  }
});
