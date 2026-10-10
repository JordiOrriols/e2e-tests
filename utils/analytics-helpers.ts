import { expect, type Page } from "@playwright/test";

const UMAMI = /umami/i;

/**
 * Runs `interact` and asserts the app neither loads the Umami tracker nor
 * reports to it. Apps rely on `@jordiorriols/ui` skipping analytics whenever
 * `navigator.webdriver` is set, which Playwright always does.
 */
export async function expectNoAnalytics(page: Page, interact: () => Promise<void>): Promise<void> {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (UMAMI.test(request.url())) requests.push(request.url());
  });
  await interact();
  expect(await page.evaluate(() => navigator.webdriver)).toBe(true);
  expect(await page.evaluate(() => typeof (window as { umami?: unknown }).umami)).toBe("undefined");
  await expect(page.locator('script[src*="umami"]')).toHaveCount(0);
  expect(requests).toEqual([]);
}
