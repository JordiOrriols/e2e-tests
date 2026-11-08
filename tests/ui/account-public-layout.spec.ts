import { test, expect } from "@playwright/test";

test("shared account controls localize login failures, retain input, and recover through caller callbacks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/iframe.html?id=views-appaccountcontrols--interactive&viewMode=story");
    await page.waitForLoadState("networkidle");
    const signIn = page.getByTestId("sign-in-button");
    await expect(signIn).toBeInViewport();
    await signIn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill("invalid@example.test");
    await page.getByLabel("Password", { exact: true }).fill("test-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toHaveText("Account: Invalid credentials");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("test-password");
    await expect(page.getByTestId("login-error")).toBeInViewport();
    await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
    await page.getByTestId("login-submit").click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByTestId("sign-out-button")).toBeVisible();
    await page.getByTestId("sign-out-button").focus();
    await page.keyboard.press("Enter");
    await expect(signIn).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByTestId("app-footer")).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});

test("shared signup/recovery messages and sign-out errors remain explicit", async ({ page }) => {
  await page.goto("/iframe.html?id=views-appaccountcontrols--interactive&viewMode=story");
  await page.getByTestId("sign-in-button").click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-info")).toHaveText("Check your email");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Already have an account", exact: true }).click();
  await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-info")).toHaveText("Reset sent");
  await page.getByRole("button", { name: "Back to sign in", exact: true }).click();
  await page.getByRole("button", { name: "Continue with GitHub", exact: true }).click();
  await expect(page.getByTestId("login-error")).toHaveText("Account: OAuth unavailable in this example");
  await page.goto("/iframe.html?id=views-appaccountcontrols--sign-out-failure&viewMode=story");
  await page.getByTestId("sign-out-button").click();
  await expect(page.getByRole("alert")).toHaveText("Account: Sign-out failed");
  await expect(page.getByTestId("sign-out-button")).toBeEnabled();
  await expect(page.getByTestId("sign-in-button")).toHaveCount(0);
});

test("public frame is mobile-localized without internal controls and preserves restricted writes and footer geometry", async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/iframe.html?id=views-publicappshell--restricted-editing&viewMode=story");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByTestId("app-footer")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Switch project" })).toHaveCount(0);
    await expect(page.getByTestId("sign-in-button")).toHaveCount(0);
    await expect(page.getByTestId("sign-out-button")).toHaveCount(0);
    await expect(page.getByTestId("app-brand-icon").locator(".lucide-square-chart-gantt")).toBeVisible();
    await expect(page.getByTestId("language-selector")).toBeInViewport();
    await page.getByTestId("language-selector").focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitemradio", { name: "Français", exact: true }).click();
    await expect(page.getByRole("link", { name: "Contribuer sur GitHub" })).toBeVisible();
    await page.getByRole("button", { name: "Save permitted changes", exact: true }).click();
    await expect(page.getByRole("main")).toContainText("Permitted changes saved.");
    const geometry = await page.evaluate(() => ({
      footerBottom: document.querySelector('[data-testid="app-footer"]')!.getBoundingClientRect().bottom,
      height: innerHeight,
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(Math.abs(geometry.footerBottom - geometry.height)).toBeLessThanOrEqual(1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    await page.goto("/iframe.html?id=views-publicappshell--long-content&viewMode=story");
    await expect(page.getByText("Member 40", { exact: true })).toBeVisible();
    const longPage = await page.getByRole("main").evaluate((main) => ({
      footerTop: document.querySelector('[data-testid="app-footer"]')!.getBoundingClientRect().top,
      mainBottom: main.getBoundingClientRect().bottom,
      overflow: getComputedStyle(main).overflowY,
    }));
    expect(longPage.footerTop).toBeGreaterThan(viewport.height);
    expect(longPage.footerTop).toBeGreaterThanOrEqual(longPage.mainBottom - 1);
    expect(longPage.overflow).not.toMatch(/auto|scroll/);
    await page.getByTestId("app-footer").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("app-footer")).toBeInViewport();
    await page.goto("/iframe.html?id=views-publicappshell--unavailable&viewMode=story");
    await expect(page.getByRole("alert")).toHaveText("This link is unavailable.");
    await expect(page.getByTestId("app-brand-icon").locator(".lucide-rocket")).toBeVisible();
  }
});
