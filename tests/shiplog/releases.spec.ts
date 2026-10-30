import { test, expect, type BrowserContext } from "@playwright/test";
import {
  api,
  authenticatedPage,
  createWorkspace,
  removeWorkspace,
  selectWorkspace,
  signIn,
} from "../planner/planner-helpers";

const baseURL = "http://127.0.0.1:5178";

test("one workspace release catalog contains multiple apps, filters and never exposes private notes", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Shiplog ${Date.now()}`);
  const contexts: BrowserContext[] = [];
  try {
    const { page, context } = await authenticatedPage(browser, owner, baseURL);
    contexts.push(context);
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Applications", exact: true }).click();
    for (const [name, slug] of [
      ["Website", "website"],
      ["Booking API", "booking-api"],
    ]) {
      await page
        .getByRole("button", { name: "New application", exact: true })
        .click();
      await page.getByLabel("Name", { exact: true }).fill(name);
      await page.getByLabel("Identifier", { exact: true }).fill(slug);
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await page
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name, exact: true }) })
        .getByRole("checkbox", {
          name: "Include in public catalog",
          exact: true,
        })
        .check();
    }
    await page.getByRole("link", { name: "Releases", exact: true }).click();
    const applications = await api<{ id: string; name: string }[]>(
      owner,
      `shiplog_applications?workspace_id=eq.${workspace.id}`,
    );
    for (const name of ["Website", "Booking API"]) {
      await page
        .getByRole("button", { name: "New release", exact: true })
        .click();
      await page
        .getByLabel("Application", { exact: true })
        .selectOption({ label: name });
      await page.getByLabel("Version", { exact: true }).fill("1.0.0");
      await page.getByLabel("Title", { exact: true }).fill(`${name} launches`);
      await page
        .getByLabel("Internal notes", { exact: true })
        .fill("SECRET: private QA report");
      await page
        .getByLabel("Public release notes", { exact: true })
        .fill(`${name} is now available.`);
      await page.getByRole("button", { name: "Create", exact: true }).click();
      const release = page
        .getByRole("article")
        .filter({ hasText: `${name} launches` });
      await expect(release).toBeVisible();
      await release
        .getByRole("button", { name: "Publish notes", exact: true })
        .click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Publish notes", exact: true })
        .click();
      await expect(
        release.getByText("Published", { exact: true }),
      ).toBeVisible();
    }
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
    const loaded = publicPage.waitForResponse(
      (response) =>
        response.url().includes("/rpc/shiplog_public_catalog") &&
        response.request().method() === "POST",
    );
    await publicPage.goto(link);
    const response = await loaded;
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual([
      "applications",
      "name",
      "releases",
    ]);
    expect(payload.releases).toHaveLength(2);
    expect(JSON.stringify(payload)).not.toContain("SECRET");
    expect(JSON.stringify(payload)).not.toContain("internal_notes");
    await expect(publicPage.getByRole("article")).toHaveCount(2);
    await publicPage
      .getByLabel("Filter by application", { exact: true })
      .selectOption({ label: "Website" });
    await expect(publicPage.getByRole("article")).toHaveCount(1);
    await expect(publicPage.getByRole("article")).toContainText(
      "Website launches",
    );
    expect(publicPage.url()).toContain(
      `application=${applications?.find((app) => app.name === "Website")?.id}`,
    );
    await publicPage.reload();
    await expect(publicPage.getByRole("article")).toHaveCount(1);
    await publicPage
      .getByRole("link", { name: /1\.0\.0\s*Website launches/ })
      .click();
    await expect(
      publicPage.getByText("Website is now available.", { exact: true }),
    ).toBeVisible();
    await expect(publicPage.getByText("SECRET", { exact: false })).toHaveCount(
      0,
    );
    await publicPage.screenshot({
      path: test.info().outputPath("public-catalog.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Revoke public catalog", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Revoke public catalog", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Enable public catalog", exact: true }),
    ).toBeVisible();
    await publicPage.reload();
    await expect(publicPage.getByRole("alert")).toContainText("unavailable");
  } finally {
    for (const context of contexts) await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});

test("Shiplog reuses workspace sharing and account sign-out controls", async ({
  browser,
}) => {
  const owner = await signIn();
  const workspace = await createWorkspace(
    owner,
    `Shiplog sharing ${Date.now()}`,
  );
  const contexts: BrowserContext[] = [];
  try {
    const { page, context } = await authenticatedPage(browser, owner, baseURL);
    contexts.push(context);
    await selectWorkspace(page, workspace.name);
    await page.getByTestId("workspace-share").click();
    const dialog = page.getByRole("alertdialog", {
      name: `Share ${workspace.name}`,
    });
    await expect(dialog.getByTestId("share-app-select")).toHaveValue("shiplog");
    await expect(dialog.getByLabel("Permission", { exact: true })).toHaveValue(
      "viewer",
    );
    await expect(dialog).toContainText("Not shared with anyone yet.");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});

test("draft changes preview safely, persist edits and lock after publication and unpublication", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Shiplog draft ${Date.now()}`);
  const contexts: BrowserContext[] = [];
  try {
    const application = await api<{ id: string }>(
      owner,
      "rpc/shiplog_create_application",
      {
        method: "POST",
        body: JSON.stringify({
          workspace: workspace.id,
          application_name: "Website",
          application_slug: "website",
          application_platform: "web",
        }),
      },
    );
    expect(application?.id).toBeTruthy();
    await api(owner, "rpc/shiplog_set_application_public", {
      method: "POST",
      body: JSON.stringify({ application: application!.id, enabled: true }),
    });
    const release = await api<{ id: string }>(
      owner,
      "rpc/shiplog_create_release",
      {
        method: "POST",
        body: JSON.stringify({
          input: {
            application_id: application!.id,
            version: "1.0.0",
            release_type: "minor",
            title: "Draft launch",
            internal_notes: "SECRET private notes",
            public_notes: "Original public notes",
          },
        }),
      },
    );
    const token = await api<string>(owner, "rpc/shiplog_portal", {
      method: "POST",
      body: JSON.stringify({ workspace: workspace.id, enabled: true }),
    });
    const { page, context } = await authenticatedPage(browser, owner, baseURL);
    contexts.push(context);
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Releases", exact: true }).click();
    await page.getByRole("button", { name: /1\.0\.0\s*Draft launch/ }).click();
    await page.getByRole("button", { name: "Edit draft", exact: true }).click();
    await page.getByLabel("Version", { exact: true }).fill("1.1.0");
    await page.getByLabel("Title", { exact: true }).fill("Updated launch");
    await page
      .getByLabel("Public release notes", { exact: true })
      .fill("New public notes");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "1.1.0 — Updated launch",
        exact: true,
      }),
    ).toBeVisible();
    for (const [title, isPublic] of [
      ["New calendar", true],
      ["SECRET internal migration", false],
      ["Temporary change", false],
    ] as const) {
      await page
        .getByRole("button", { name: "Add change", exact: true })
        .click();
      await page.getByLabel("Title", { exact: true }).fill(title);
      await page
        .getByLabel("Description", { exact: true })
        .fill(`${title} details`);
      const checkbox = page.getByRole("checkbox", {
        name: "Public change",
        exact: true,
      });
      await expect(checkbox).not.toBeChecked();
      if (isPublic) await checkbox.check();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }
    await page
      .getByRole("button", { name: "Edit change New calendar", exact: true })
      .click();
    await page
      .getByLabel("Category", { exact: true })
      .selectOption("improvement");
    await page.getByLabel("Title", { exact: true }).fill("Improved calendar");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Improved calendar", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Delete change Temporary change",
        exact: true,
      })
      .click();
    await page
      .getByRole("alertdialog", {
        name: "Delete change Temporary change",
        exact: true,
      })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(
      page.getByText("Temporary change", { exact: true }),
    ).toHaveCount(0);
    const previewResponse = page.waitForResponse((response) =>
      response.url().includes("/rpc/shiplog_preview_release"),
    );
    await page
      .getByRole("button", { name: "Public preview", exact: true })
      .click();
    const preview = await (await previewResponse).json();
    expect(preview.changes).toEqual([
      {
        category: "improvement",
        title: "Improved calendar",
        description: "New calendar details",
      },
    ]);
    expect(Object.keys(preview).sort()).toEqual([
      "application_id",
      "changes",
      "id",
      "public_notes",
      "published_at",
      "release_type",
      "title",
      "version",
    ]);
    expect(JSON.stringify(preview)).not.toContain("SECRET");
    await expect(
      page.getByText("Improved calendar", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("SECRET", { exact: false })).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("draft-preview.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "Close", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("heading", {
        name: "1.1.0 — Updated launch",
        exact: true,
      }),
    ).toBeInViewport();
    await page.screenshot({
      path: test.info().outputPath("draft-preview-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    const anonymous = await browser.newContext();
    contexts.push(anonymous);
    const publicPage = await anonymous.newPage();
    const publicURL = `${baseURL}/#/public/${token}/releases`;
    await publicPage.goto(publicURL);
    await expect(publicPage.getByRole("status")).toHaveText(
      "No published releases to show.",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page
      .getByRole("button", { name: /1\.1\.0\s*Updated launch/ })
      .click();
    await expect(
      page.getByText("SECRET internal migration", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Temporary change", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Publish notes", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Publish notes", exact: true })
      .click();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
    const publicResponse = publicPage.waitForResponse((response) =>
      response.url().includes("/rpc/shiplog_public_catalog"),
    );
    await publicPage.reload();
    const catalog = await (await publicResponse).json();
    expect({ ...catalog.releases[0], published_at: null }).toEqual(preview);
    await expect(
      publicPage.getByText("Improved calendar", { exact: true }),
    ).toBeVisible();
    await expect(publicPage.getByText("SECRET", { exact: false })).toHaveCount(
      0,
    );
    for (const published of [true, false]) {
      if (!published) {
        await page
          .getByRole("button", { name: "Unpublish notes", exact: true })
          .click();
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: "Unpublish notes", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Publish notes", exact: true }),
        ).toBeVisible();
      }
      await page
        .getByRole("button", { name: /1\.1\.0\s*Updated launch/ })
        .click();
      await expect(page.getByText(/Release history is locked/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Edit draft", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Add change", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "Delete change Improved calendar",
          exact: true,
        }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Close", exact: true }).click();
    }
    const content = await api<{ first_published_at: string }[]>(
      owner,
      `shiplog_releases?id=eq.${release!.id}&select=first_published_at`,
    );
    expect(content?.[0]?.first_published_at).toBeTruthy();
    await publicPage.reload();
    await expect(publicPage.getByRole("article")).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
