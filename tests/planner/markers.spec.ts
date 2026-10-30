import { test, expect, type BrowserContext } from "@playwright/test";
import {
  addFeatures,
  api,
  authenticatedPage,
  createRoster,
  createWorkspace,
  removeWorkspace,
  selectWorkspace,
  signIn,
} from "./planner-helpers";

test("date markers can be managed, shared and toggled for only the browser session", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner);
  const contexts: BrowserContext[] = [];
  try {
    await createRoster(
      owner,
      "Marker team",
      [{ name: "Backend", planning_role: "backend" }],
      workspace.id,
    );
    await addFeatures(owner, workspace.id, [
      { name: "Checkout", backend_devs: 1, backend_weeks: 1 },
    ]);
    await api(owner, `workspaces?id=eq.${workspace.id}`, {
      method: "PATCH",
      body: JSON.stringify({ plan_start_date: "2026-02-02" }),
    });
    const { page, context } = await authenticatedPage(browser, owner);
    contexts.push(context);
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Roadmap", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Hide markers", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Manage markers", exact: true })
      .click();
    await expect(
      page.getByText("No markers yet. Add an important date above.", {
        exact: true,
      }),
    ).toBeVisible();
    for (const [name, date] of [
      ["Release", "2026-02-06"],
      ["Launch", "2026-02-04"],
      ["Future", "2028-01-01"],
    ]) {
      await page.getByLabel("Marker name", { exact: true }).fill(name);
      await page.getByLabel("Marker date", { exact: true }).fill(date);
      await page
        .getByRole("button", { name: "Add marker", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: `Delete marker ${name}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByLabel("Marker name", { exact: true })).toHaveValue(
        "",
      );
    }
    expect(
      await page
        .getByRole("button", { name: /^Delete marker / })
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute("aria-label")),
        ),
    ).toEqual([
      "Delete marker Launch",
      "Delete marker Release",
      "Delete marker Future",
    ]);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const launch = page.getByRole("img", {
      name: "Launch: Feb 4, 2026",
      exact: true,
    });
    await expect(launch).toBeVisible();
    await expect(page.getByRole("img", { name: /^Future:/ })).toHaveCount(0);
    const expectedLeft = await launch.evaluate((element) =>
      parseFloat((element as HTMLElement).style.left),
    );
    expect(expectedLeft).toBeGreaterThan(0);
    await page
      .getByRole("button", { name: "Hide markers", exact: true })
      .click();
    await expect(launch).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Show markers", exact: true }),
    ).toBeVisible();
    await expect(launch).toHaveCount(0);
    await page
      .getByRole("button", { name: "Show markers", exact: true })
      .click();
    await expect(launch).toBeVisible();

    await page.getByTestId("workspace-share").click();
    await page.getByRole("tab", { name: "Link", exact: true }).click();
    await page
      .getByRole("button", { name: "Enable public link", exact: true })
      .click();
    const link = await page
      .getByRole("textbox", { name: "Public link", exact: true })
      .inputValue();
    await page.getByTestId("share-workspace-dialog")
      .getByRole("button", { name: "Close", exact: true }).click();
    const anonymous = await browser.newContext();
    contexts.push(anonymous);
    const publicPage = await anonymous.newPage();
    const loaded = publicPage.waitForResponse(
      (response) =>
        response.url().includes("/functions/v1/roadmap") &&
        response.request().method() === "POST",
    );
    await publicPage.goto(link);
    const response = await loaded;
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.markers).toEqual([
      { name: "Launch", date: "2026-02-04" },
      { name: "Release", date: "2026-02-06" },
      { name: "Future", date: "2028-01-01" },
    ]);
    await expect(
      publicPage.getByRole("button", { name: "Show markers", exact: true }),
    ).toBeVisible();
    await expect(publicPage.getByRole("img", { name: /^Launch:/ })).toHaveCount(
      0,
    );
    await expect(
      publicPage.getByRole("button", { name: "Manage markers", exact: true }),
    ).toHaveCount(0);
    await publicPage
      .getByRole("button", { name: "Show markers", exact: true })
      .click();
    await expect(
      publicPage.getByRole("img", { name: "Launch: Feb 4, 2026", exact: true }),
    ).toBeVisible();
    await publicPage.reload();
    await expect(
      publicPage.getByRole("button", { name: "Hide markers", exact: true }),
    ).toBeVisible();
    await expect(
      publicPage.getByRole("img", { name: /^Launch:/ }),
    ).toBeVisible();
    await publicPage.screenshot({
      path: test.info().outputPath("public-markers.png"),
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "Manage markers", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete marker Launch", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Delete marker Launch", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(launch).toHaveCount(0);
    await publicPage.reload();
    await expect(
      publicPage.getByRole("img", { name: /^Release:/ }),
    ).toBeVisible();
    await expect(publicPage.getByRole("img", { name: /^Launch:/ })).toHaveCount(
      0,
    );

    const fresh = await authenticatedPage(browser, owner);
    contexts.push(fresh.context);
    await selectWorkspace(fresh.page, workspace.name);
    await fresh.page
      .getByRole("link", { name: "Roadmap", exact: true })
      .click();
    await expect(
      fresh.page.getByRole("button", { name: "Hide markers", exact: true }),
    ).toBeVisible();
    const freshPublic = await browser.newContext();
    contexts.push(freshPublic);
    const newPublicPage = await freshPublic.newPage();
    await newPublicPage.goto(link);
    await expect(
      newPublicPage.getByRole("button", { name: "Show markers", exact: true }),
    ).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
