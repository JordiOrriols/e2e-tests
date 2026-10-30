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

test("public roadmap stays live, hides technical inputs, and can be revoked", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const owner = await signIn();
  const workspace = await createWorkspace(owner);
  const contexts: BrowserContext[] = [];
  try {
    await createRoster(
      owner,
      "Roadmap sharing test",
      [{ name: "Private person", planning_role: "backend" }],
      workspace.id,
    );
    await addFeatures(owner, workspace.id, [
      { name: "Checkout", backend_devs: 1, backend_weeks: 1 },
    ]);
    await api(owner, `workspaces?id=eq.${workspace.id}`, {
      method: "PATCH",
      body: JSON.stringify({ plan_start_date: "2026-02-02" }),
    });
    const opened = await authenticatedPage(browser, owner);
    contexts.push(opened.context);
    await selectWorkspace(opened.page, workspace.name);
    await opened.page
      .getByRole("link", { name: "Roadmap", exact: true })
      .click();
    await expect(
      opened.page.getByRole("button", { name: "Share roadmap", exact: true }),
    ).toHaveCount(0);
    await opened.page.getByTestId("workspace-share").click();
    const sharing = opened.page.getByTestId("share-workspace-dialog");
    const people = sharing.getByRole("region", { name: "People with access" });
    const publicLink = sharing.getByRole("region", { name: "Public link" });
    await expect(people).toBeVisible();
    await expect(sharing.getByRole("tab", { name: "Emails", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect(publicLink).toHaveCount(0);
    await sharing.getByRole("tab", { name: "Link", exact: true }).click();
    await expect(publicLink).toBeVisible();
    await expect(people).toHaveCount(0);
    await expect.poll(async () => (await sharing.boundingBox())!.width)
      .toBeCloseTo(968, 0);
    const bounds = await sharing.boundingBox();
    expect(bounds!.height).toBeLessThanOrEqual(
      opened.page.viewportSize()!.height * 0.7 + 1,
    );
    await opened.page
      .getByRole("button", { name: "Enable public link", exact: true })
      .click();
    const link = await opened.page
      .getByRole("textbox", { name: "Public link", exact: true })
      .inputValue();
    await opened.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await sharing.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(sharing.getByRole("status")).toHaveText("Link copied");
    expect(await opened.page.evaluate(() => navigator.clipboard.readText()))
      .toBe(link);

    const anonymous = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    contexts.push(anonymous);
    const page = await anonymous.newPage();
    const loaded = page.waitForResponse(
      (response) =>
        response.url().includes("/functions/v1/roadmap") &&
        response.request().method() === "POST",
    );
    await page.goto(link);
    const response = await loaded;
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual([
      "features",
      "markers",
      "name",
      "startDate",
    ]);
    expect(Object.keys(payload.features[0]).sort()).toEqual([
      "complete",
      "end",
      "name",
      "project",
      "start",
      "status",
    ]);
    await expect(
      page.getByRole("img", {
        name: "Checkout: Feb 2, 2026 to Feb 20, 2026 · Pending",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: /^Status: / })).toHaveCount(0);
    await expect(
      page.getByRole("img", { name: /^Checkout: .* · Pending$/ }),
    ).toHaveClass(/bg-slate-400/);
    await expect(page.locator('[data-guide="week"]').first()).toBeAttached();
    await expect(page.getByTestId("app-footer")).toBeVisible();
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByTestId("language-button-es").click();
    await expect(
      page.getByRole("button", { name: "Ancho completo", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Idioma", exact: true }).click();
    await page.getByTestId("language-button-en").click();
    await expect(
      page.getByRole("button", { name: "Full width", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Private person")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("Backend", { exact: true })).toHaveCount(0);
    await expect(page.getByText("UAT", { exact: true })).toHaveCount(0);

    const features = await api<{ id: string }[]>(
      owner,
      `features?select=id,projects!inner(workspace_id)&projects.workspace_id=eq.${workspace.id}`,
    );
    if (!features?.[0]) throw new Error("Seeded feature missing");
    await api(owner, `features?id=eq.${features[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ backend_weeks: 2 }),
    });
    await page.reload();
    await expect(
      page.getByRole("img", {
        name: "Checkout: Feb 2, 2026 to Feb 27, 2026 · Pending",
        exact: true,
      }),
    ).toBeVisible();

    await opened.page
      .getByRole("button", { name: "Revoke public link", exact: true })
      .click();
    await opened.page
      .getByTestId("confirm-dialog")
      .getByRole("button", { name: "Revoke public link", exact: true })
      .click();
    await expect(
      opened.page.getByRole("button", {
        name: "Enable public link",
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("unavailable");
    await expect(page.getByRole("img")).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
