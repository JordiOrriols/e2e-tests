import { test, expect, type BrowserContext } from "@playwright/test";
import {
  api,
  authenticatedPage,
  createWorkspace,
  removeWorkspace,
  selectWorkspace,
  signIn,
} from "../planner/planner-helpers";

test("editable applications, existing teams, QA checks, individual approvals and manual release tags persist", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Shiplog QA ${Date.now()}`);
  const contexts: BrowserContext[] = [];
  try {
    const team = await api<{ id: string }>(owner, "rpc/create_team", {
      method: "POST",
      body: JSON.stringify({
        p_name: "Engineering",
        p_workspace: workspace.id,
      }),
    });
    const { page, context } = await authenticatedPage(
      browser,
      owner,
      "http://127.0.0.1:5178",
    );
    contexts.push(context);
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Applications", exact: true }).click();
    await page
      .getByRole("button", { name: "New application", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill("Website");
    await expect(page.getByLabel("Identifier", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Platform", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Website", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit Website", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill("Website renamed");
    await page
      .getByLabel("Team (optional)", { exact: true })
      .selectOption(team!.id);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("article")).toContainText("Engineering");
    await page.reload();
    await page
      .getByRole("button", { name: "Edit Website renamed", exact: true })
      .click();
    await expect(
      page.getByLabel("Team (optional)", { exact: true }),
    ).toHaveValue(team!.id);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "Include in public catalog", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Checklist template", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add checklist item", exact: true })
      .click();
    await page.getByLabel("Title", { exact: true }).fill("Code review");
    await page.getByLabel("Category", { exact: true }).fill("QA");
    await page
      .getByLabel("Description", { exact: true })
      .fill("SECRET check details");
    await page.getByRole("button", { name: "Apply item", exact: true }).click();
    await page
      .getByRole("button", { name: "Save template", exact: true })
      .click();
    await expect(
      page.getByText("Checklist template revision 1", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("link", { name: "Releases", exact: true }).click();
    await page
      .getByRole("button", { name: "New release", exact: true })
      .click();
    await expect(page.getByLabel("Release type", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByLabel("Internal notes", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Version", { exact: true }).fill("1.0.0");
    await page.getByLabel("Title", { exact: true }).fill("Initial release");
    await page
      .getByLabel("Public release notes", { exact: true })
      .fill("Public launch notes");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const card = page
      .getByRole("article")
      .filter({ hasText: "Initial release" });
    await expect(card.getByText("Draft", { exact: true })).toBeVisible();
    await expect(card).toContainText("Major");
    await page
      .getByRole("button", { name: /1\.0\.0\s*Initial release/ })
      .click();
    await page.getByRole("button", { name: "QA", exact: true }).click();
    const check = page.getByRole("checkbox", {
      name: "Code review",
      exact: true,
    });
    await check.check();
    await expect(
      page.getByText("1 of 1 checks passed", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Release status", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Release details", exact: true }).click();
    await page.getByLabel("Release status", { exact: true }).selectOption("qa");
    await expect(
      page.getByLabel("Release status", { exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByLabel("Release status", { exact: true }),
    ).toHaveValue("qa");
    await expect(page.getByRole("button", { name: "Approvals", exact: true })).toHaveCount(0);
    await page
      .getByLabel("Release status", { exact: true })
      .selectOption("released");
    await expect(
      page.getByLabel("Release status", { exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByLabel("Release status", { exact: true }),
    ).toHaveValue("released");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "Close", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: test.info().outputPath("simple-approvals-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(card.getByText("Released", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await page
      .getByRole("button", { name: /1\.0\.0\s*Initial release/ })
      .click();
    await page.getByRole("button", { name: "QA", exact: true }).click();
    await expect(check).toBeChecked();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    for (const [decision, label] of [["approved", "Approved"], ["disapproved", "Disapproved"], ["approved", "Approved"]] as const) {
      await card.getByRole("combobox", { name: "Your approval" }).selectOption(decision);
      await expect(card.getByRole("list").getByText(label, { exact: true })).toBeVisible();
      await expect(card.getByText("Released", { exact: true })).toBeVisible();
    }
    await page.reload();
    await expect(card.getByRole("combobox", { name: "Your approval" })).toHaveValue("approved");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(card.getByRole("combobox", { name: "Your approval" })).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath("release-approval-badges-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page
      .getByRole("button", { name: /1\.0\.0\s*Initial release/ })
      .click();
    await page
      .getByLabel("Public release notes", { exact: true })
      .fill("Updated published notes");
    await page
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page
      .getByRole("button", { name: /1\.0\.0\s*Initial release/ })
      .click();
    await expect(
      page.getByLabel("Public release notes", { exact: true }),
    ).toHaveValue("Updated published notes");
    const token = await api<string>(owner, "rpc/shiplog_portal", {
      method: "POST",
      body: JSON.stringify({ workspace: workspace.id, enabled: true }),
    });
    const anonymous = await browser.newContext();
    contexts.push(anonymous);
    const publicPage = await anonymous.newPage();
    const response = publicPage.waitForResponse(
      (response) =>
        response.url().includes("/rpc/shiplog_public_catalog") &&
        response.request().method() === "POST",
    );
    await publicPage.goto(`http://127.0.0.1:5178/#/public/${token}/releases`);
    const payload = await (await response).json();
    expect(payload.releases[0].public_notes).toBe("Updated published notes");
    for (const secret of [
      "SECRET",
      "qa_status",
      "approved_by",
      "user_id",
      "team_id",
      "internal_notes",
    ])
      expect(JSON.stringify(payload)).not.toContain(secret);
    await expect(
      publicPage.getByText("Updated published notes", { exact: true }),
    ).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
