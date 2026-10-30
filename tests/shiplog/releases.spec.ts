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
    for (const name of ["Website", "Booking API"]) {
      await page
        .getByRole("button", { name: "New application", exact: true })
        .click();
      await page.getByLabel("Name", { exact: true }).fill(name);
      const save = page.getByRole("button", { name: "Save", exact: true });
      await expect(save).toHaveAttribute("form", "application-form");
      await expect(save).toHaveCSS("background-color", "oklch(0.205 0 0)");
      await expect(page.locator("#application-form button[type=submit]")).toHaveCount(0);
      await expect(save.locator("..").getByRole("button", { name: "Close", exact: true })).toBeVisible();
      await save.click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("checkbox", { name: "Include in public catalog", exact: true })).toHaveCount(0);
    }
    await page.getByRole("link", { name: "Releases", exact: true }).click();
    const applications = await api<{ id: string; name: string }[]>(
      owner,
      `shiplog_applications?workspace_id=eq.${workspace.id}`,
    );
    for (const app of applications ?? []) expect(app).not.toHaveProperty("public_enabled");
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
        .getByLabel("Public release notes", { exact: true })
        .fill(`${name} is now available.`);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveAttribute("form", "release-create-form");
      await expect(page.locator("#release-create-form button[type=submit]")).toHaveCount(0);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const release = page
        .getByRole("article")
        .filter({ hasText: `${name} launches` });
      await expect(release).toBeVisible();
      await expect(release.getByRole("button").locator("span").filter({ hasText: new RegExp(`^${name}$`) })).toHaveClass(/rounded-md/);
      await expect(release.getByText("Draft", { exact: true })).toBeVisible();
      await expect(release.getByRole("combobox", { name: "Your approval" })).toBeVisible();
      await expect(release.getByRole("button", { name: /publish/i })).toHaveCount(0);
    }
    await expect(
      page.getByRole("link", { name: "Public portal", exact: true }),
    ).toHaveCount(0);
    await page.getByTestId("workspace-share").click();
    const sharing = page.getByTestId("share-workspace-dialog");
    await expect(
      sharing.getByRole("region", { name: "People with access" }),
    ).toBeVisible();
    await expect(sharing.getByRole("tab", { name: "Emails", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect(sharing.getByRole("region", { name: "Public link" })).toHaveCount(0);
    await sharing.getByRole("tab", { name: "Link", exact: true }).click();
    await expect(
      sharing.getByRole("region", { name: "Public link" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Enable public link", exact: true })
      .click();
    const link = await page
      .getByRole("textbox", { name: "Public link", exact: true })
      .inputValue();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await sharing.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(sharing.getByRole("status")).toHaveText("Link copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    const anonymous = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
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
      .getByRole("button", { name: "Revoke public link", exact: true })
      .click();
    await page
      .getByTestId("confirm-dialog")
      .getByRole("button", { name: "Revoke public link", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Enable public link", exact: true }),
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
    await expect(dialog.getByRole("tab", { name: "Emails", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    const email = dialog.getByLabel("Email", { exact: true });
    await email.fill("draft@example.com");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await dialog.boundingBox())!.width)
      .toBeCloseTo(358, 0);
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(15);
    expect(bounds.height).toBeLessThanOrEqual(844 * 0.7 + 1);
    await dialog.getByRole("tab", { name: "Link", exact: true }).click();
    await dialog.getByRole("button", { name: "Enable public link", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "Close", exact: true }))
      .toBeInViewport();
    await page.screenshot({ path: test.info().outputPath("mobile-sharing.png") });
    await dialog.getByRole("tab", { name: "Link", exact: true }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByRole("tab", { name: "Emails", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect(email).toHaveValue("draft@example.com");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByTestId("workspace-share").click();
    await expect(dialog.getByRole("tab", { name: "Emails", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect(email).toHaveValue("");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${baseURL}/#/portal`);
    await expect(page).toHaveURL(`${baseURL}/#/`);
    await expect(page.getByTestId("workspace-share")).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});

test("draft changes persist, public catalogs include drafts safely, and editing follows manual release status", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner, `Shiplog draft ${Date.now()}`);
  const contexts: BrowserContext[] = [];
  try {
    const application = await api<{ id: string }>(
      owner,
      "rpc/shiplog_save_application",
      {
        method: "POST",
        body: JSON.stringify({
          workspace: workspace.id,
          application_name: "Website",
        }),
      },
    );
    expect(application?.id).toBeTruthy();
    const release = await api<{ id: string }>(
      owner,
      "rpc/shiplog_create_release",
      {
        method: "POST",
        body: JSON.stringify({
          input: {
            application_id: application!.id,
            version: "1.0.0",
            title: "Draft launch",
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
    for (const name of ["Public preview", "Approvals", "Deployments"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("release-details.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "Close", exact: true }),
    ).toBeInViewport();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
    await expect(
      page.getByRole("heading", {
        name: "1.1.0 — Updated launch",
        exact: true,
      }),
    ).toBeInViewport();
    await page.screenshot({
      path: test.info().outputPath("release-details-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    const anonymous = await browser.newContext();
    contexts.push(anonymous);
    const publicPage = await anonymous.newPage();
    const publicURL = `${baseURL}/#/public/${token}/releases`;
    const publicResponse = publicPage.waitForResponse((response) => response.url().includes("/rpc/shiplog_public_catalog"));
    await publicPage.goto(publicURL);
    const catalog = await (await publicResponse).json();
    expect(catalog.releases).toHaveLength(1);
    expect(catalog.releases[0].status).toBe("draft");
    expect(catalog.releases[0].changes).toEqual([{ category: "improvement", title: "Improved calendar", description: "New calendar details" }]);
    expect(Object.keys(catalog.releases[0]).sort()).toEqual(["application_id", "changes", "created_at", "id", "public_notes", "release_type", "status", "title", "version"]);
    expect(JSON.stringify(catalog)).not.toContain("SECRET");
    await expect(publicPage.getByText("Improved calendar", { exact: true })).toBeVisible();
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
    for (const status of ["qa", "released"]) {
      await page.getByLabel("Release status", { exact: true }).selectOption(status);
      await expect(page.getByLabel("Release status", { exact: true })).toBeEnabled();
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
      await page.getByLabel("Public release notes", { exact: true }).fill(`Notes in ${status}`);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      await publicPage.reload();
      await expect(publicPage.getByText(`Notes in ${status}`, { exact: true })).toBeVisible();
      await expect(publicPage.getByText(status === "qa" ? "QA" : "Released", { exact: true })).toBeVisible();
    }
    await page.getByLabel("Release status", { exact: true }).selectOption("draft");
    await expect(page.getByRole("button", { name: "Edit draft", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const content = await api<Record<string, unknown>[]>(owner, `shiplog_releases?id=eq.${release!.id}`);
    expect(content?.[0]).not.toHaveProperty("published_at");
    expect(content?.[0]).not.toHaveProperty("first_deployed_at");
  } finally {
    for (const context of contexts) await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
