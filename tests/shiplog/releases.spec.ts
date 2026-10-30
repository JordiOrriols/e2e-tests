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
