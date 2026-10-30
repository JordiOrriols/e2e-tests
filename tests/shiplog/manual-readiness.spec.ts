import { test, expect, type BrowserContext } from "@playwright/test";
import {
  api,
  authenticatedPage,
  createWorkspace,
  removeWorkspace,
  selectWorkspace,
  signIn,
} from "../planner/planner-helpers";

test("manual checklist snapshots, QA gates, owner overrides and approval persist in Supabase", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Shiplog QA ${Date.now()}`);
  const contexts: BrowserContext[] = [];
  try {
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
    await page.getByLabel("Identifier", { exact: true }).fill("website");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Website", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Include in public catalog", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Checklist template", exact: true })
      .click();
    for (const [title, mandatory] of [
      ["Code review", true],
      ["Notify support", false],
    ] as const) {
      await page
        .getByRole("button", { name: "Add checklist item", exact: true })
        .click();
      await page.getByLabel("Title", { exact: true }).fill(title);
      await page.getByLabel("Category", { exact: true }).fill("Development");
      await page
        .getByLabel("Description", { exact: true })
        .fill(`SECRET ${title} details`);
      if (!mandatory)
        await page
          .getByRole("checkbox", { name: "Mandatory", exact: true })
          .uncheck();
      await page
        .getByRole("button", { name: "Apply item", exact: true })
        .click();
    }
    await page
      .getByRole("button", { name: "Save template", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "Checklist template saved.",
    );
    await expect(
      page.getByText("Checklist template revision 1", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const createRelease = async (version: string, title: string) => {
      await page.getByRole("link", { name: "Releases", exact: true }).click();
      await page
        .getByRole("button", { name: "New release", exact: true })
        .click();
      await page.getByLabel("Version", { exact: true }).fill(version);
      await page.getByLabel("Title", { exact: true }).fill(title);
      await page
        .getByLabel("Public release notes", { exact: true })
        .fill("Public launch notes");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(
        page.getByRole("article").filter({ hasText: title }),
      ).toBeVisible();
    };
    await createRelease("1.0.0", "Initial release");
    await page.getByRole("link", { name: "Applications", exact: true }).click();
    await page
      .getByRole("button", { name: "Checklist template", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Edit checklist item Code review",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("New code review rule");
    await page.getByRole("button", { name: "Apply item", exact: true }).click();
    await page
      .getByRole("button", { name: "Save template", exact: true })
      .click();
    await expect(
      page.getByText("Checklist template revision 2", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await createRelease("1.1.0", "Later release");
    await page.getByRole("button", { name: /1\.1\.0\s*Later release/ }).click();
    await page.getByRole("button", { name: "Readiness", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "New code review rule", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Checklist template revision 2", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: /1\.0\.0\s*Initial release/ })
      .click();
    await page.getByRole("button", { name: "Readiness", exact: true }).click();
    await expect(
      page.getByText("Checklist template revision 1", { exact: true }),
    ).toBeVisible();
    const checkbox = page.getByRole("checkbox", {
      name: "Code review",
      exact: true,
    });
    await expect(checkbox).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "New code review rule", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Mark ready for QA", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm readiness decision", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "requirements are incomplete",
    );
    await page
      .getByLabel(
        "Owner override reason (only needed for unmet requirements)",
        { exact: true },
      )
      .fill("Review scheduled during QA");
    await page
      .getByRole("button", { name: "Confirm readiness decision", exact: true })
      .click();
    await expect(page.getByLabel("QA result", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit draft", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/Release history is locked/)).toBeVisible();
    await page.getByLabel("QA result", { exact: true }).selectOption("failed");
    await page
      .getByLabel("QA observations", { exact: true })
      .fill("SECRET regression");
    await page
      .getByRole("button", { name: "Record QA result", exact: true })
      .click();
    await expect(
      page.getByRole("paragraph").filter({ hasText: /^SECRET regression$/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Approve release", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm readiness decision", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "requirements are incomplete",
    );
    await page
      .getByLabel(
        "Owner override reason (only needed for unmet requirements)",
        { exact: true },
      )
      .fill("Emergency release accepted");
    await page
      .getByRole("button", { name: "Confirm readiness decision", exact: true })
      .click();
    await expect(
      page.getByText("Owner override: Emergency release accepted", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeDisabled();
    await expect(page.getByLabel("QA result", { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Reopen QA", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Reopen QA", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Close", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: test.info().outputPath("manual-readiness-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Reopen QA", exact: true }).click();
    await page
      .getByLabel("Reason for reopening QA", { exact: true })
      .fill("Verify regression fix");
    await page
      .getByRole("button", { name: "Confirm readiness decision", exact: true })
      .click();
    await expect(page.getByLabel("QA result", { exact: true })).toHaveValue(
      "not_started",
    );
    await checkbox.check();
    await expect(
      page.getByText("1 of 2 completed · 0 mandatory remaining", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("QA result", { exact: true }).selectOption("passed");
    await page
      .getByLabel("QA observations", { exact: true })
      .fill("SECRET regression fixed");
    await page
      .getByRole("button", { name: "Record QA result", exact: true })
      .click();
    await expect(
      page
        .getByRole("paragraph")
        .filter({ hasText: /^SECRET regression fixed$/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Approve release", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm readiness decision", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Reopen QA", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Owner override: Emergency release accepted", {
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page
      .getByRole("button", { name: /1\.0\.0\s*Initial release/ })
      .click();
    await page.getByRole("button", { name: "Readiness", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Code review", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Code review", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Reopen QA", exact: true }),
    ).toBeVisible();
    const releases = await api<
      {
        id: string;
        version: string;
        status: string;
        published_at: string | null;
      }[]
    >(owner, `shiplog_releases?workspace_id=eq.${workspace.id}`);
    const initial = releases!.find((row) => row.version === "1.0.0")!;
    expect(initial.status).toBe("approved");
    expect(initial.published_at).toBeNull();
    const readiness = await api<{
      qa_status: string;
      qa_recorded_by: string;
      approved_by: string;
      items: { completed_by: string | null }[];
    }>(owner, "rpc/shiplog_get_readiness", {
      method: "POST",
      body: JSON.stringify({ release: initial.id }),
    });
    expect(readiness?.qa_status).toBe("passed");
    expect(readiness?.qa_recorded_by).toBe(owner.user.id);
    expect(readiness?.approved_by).toBe(owner.user.id);
    expect(readiness?.items[0]?.completed_by).toBe(owner.user.id);
    const events = await api<
      { event: string; details: { override_reason?: string } }[]
    >(owner, `shiplog_audit_events?release_id=eq.${initial.id}`);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "readiness.ready_for_qa",
          details: expect.objectContaining({
            override_reason: "Review scheduled during QA",
          }),
        }),
        expect.objectContaining({
          event: "readiness.approved",
          details: expect.objectContaining({
            override_reason: "Emergency release accepted",
          }),
        }),
        expect.objectContaining({
          event: "readiness.reopen_qa",
          details: expect.objectContaining({
            override_reason: "Verify regression fix",
          }),
        }),
      ]),
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
    const article = page
      .getByRole("article")
      .filter({ hasText: "Initial release" });
    await article
      .getByRole("button", { name: "Publish notes", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Publish notes", exact: true })
      .click();
    await expect(article.getByText("Published", { exact: true })).toBeVisible();
    await page
      .getByRole("link", { name: "Public portal", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Enable public catalog", exact: true })
      .click();
    const link = await page
      .getByRole("textbox", { name: "Public releases link", exact: true })
      .inputValue();
    const anonymous = await browser.newContext();
    contexts.push(anonymous);
    const publicPage = await anonymous.newPage();
    const response = publicPage.waitForResponse(
      (item) =>
        item.url().includes("/rpc/shiplog_public_catalog") &&
        item.request().method() === "POST",
    );
    await publicPage.goto(link);
    const payload = JSON.stringify(await (await response).json());
    for (const privateField of [
      "SECRET",
      "qa_status",
      "qa_notes",
      "template_revision",
      "completed_by",
      "approved_by",
    ])
      expect(payload).not.toContain(privateField);
    await expect(publicPage.getByRole("article")).toHaveCount(1);
    await expect(
      publicPage.getByText("Public launch notes", { exact: true }),
    ).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
