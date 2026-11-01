import { expect, type Page } from "@playwright/test";

export async function expectPublicLayout(page: Page) {
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByTestId("app-footer")).toHaveCount(1);
  await expect(page.getByTestId("sign-in-button")).toHaveCount(0);
  await expect(page.getByTestId("sign-out-button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Switch project", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByTestId("language-selector")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
  await page.getByTestId("language-selector").click();
  await page.getByRole("menuitemradio", { name: "Français", exact: true }).click();
  await expect(page.getByTestId("app-footer")).toHaveText("Fait avec amour par Jordi Orriols");
  await page.getByTestId("language-selector").click();
  await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
}
