import { test, expect } from "@playwright/test";
import { authenticatedPage, signIn, createWorkspace, removeWorkspace, selectWorkspace } from "../planner/planner-helpers";

export function accountLayoutTests(app: "ladders" | "planner" | "pulse" | "shiplog", url: string) {
  test(`${app} uses shared login errors, authenticated framing and keyboard sign-out`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
      await page.route("**/auth/v1/token?*", (route) => route.fulfill({
        status: 400, contentType: "application/json",
        body: JSON.stringify({ error_code: "invalid_credentials", msg: "Invalid login credentials" }),
      }));
      await page.goto(url);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByLabel("Email", { exact: true }).fill("layout@example.test");
      await page.getByLabel("Password", { exact: true }).fill("test-password");
      await page.getByTestId("login-submit").click();
      await expect(page.getByTestId("login-error")).toBeVisible();
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue("layout@example.test");
      await expect(page.getByLabel("Password", { exact: true })).toHaveValue("test-password");
    } finally {
      await context.close();
    }
    const owner = await signIn();
    const workspace = await createWorkspace(owner, `${app} layout ${Date.now()}`);
    const opened = await authenticatedPage(browser, owner, url);
    try {
      await selectWorkspace(opened.page, workspace.name);
      await expect(opened.page.getByTestId("sign-out-button")).toBeVisible();
      await expect(opened.page.getByRole("banner")).toHaveCount(1);
      await expect(opened.page.getByRole("main")).toHaveCount(1);
      await expect(opened.page.getByTestId("app-footer")).toHaveCount(1);
      for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
        await opened.page.setViewportSize(viewport);
        await expect(async () => {
          const footer = await opened.page.getByTestId("app-footer").boundingBox();
          const pageBottom = await opened.page.evaluate(() => Math.max(innerHeight, document.documentElement.scrollHeight));
          expect(footer).not.toBeNull();
          const scrollY = await opened.page.evaluate(() => window.scrollY);
          expect(Math.abs(footer!.y + scrollY + footer!.height - pageBottom)).toBeLessThanOrEqual(2);
        }).toPass({ timeout: 5_000 });
      }
      await opened.page.getByTestId("sign-out-button").focus();
      await opened.page.keyboard.press("Enter");
      await expect(opened.page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      await expect(opened.page.getByTestId("sign-out-button")).toHaveCount(0);
    } finally {
      await opened.context.close();
      await removeWorkspace(owner, workspace.id);
    }
  });
}
