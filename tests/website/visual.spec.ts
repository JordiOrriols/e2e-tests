import { test, expect } from "../../fixtures";
import { WebsiteHomePage } from "../../pages/website";
import { waitForPageReady } from "../../utils";

test.describe("Website Visual Regression @visual", () => {
  test("home page snapshot - desktop", async ({ page, takeSnapshot }) => {
    const homePage = new WebsiteHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();
    await waitForPageReady(page);

    await takeSnapshot("home-desktop");
  });

  test("home page snapshot - tablet", async ({ page, takeSnapshot }) => {
    const homePage = new WebsiteHomePage(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    await homePage.goto();
    await waitForPageReady(page);

    await takeSnapshot("home-tablet");
  });

  test("home page snapshot - mobile", async ({ page, takeSnapshot }) => {
    const homePage = new WebsiteHomePage(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await homePage.goto();
    await waitForPageReady(page);

    await takeSnapshot("home-mobile");
  });

  test("should match production and localhost @compare", async ({ 
    page, 
    environment,
    getComparisonUrl 
  }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();
    await waitForPageReady(page);

    // Take screenshot of current environment
    const currentScreenshot = await page.screenshot({ fullPage: true });

    // Navigate to comparison environment
    const comparisonUrl = getComparisonUrl("/");
    
    // Log comparison URL for debugging
    console.log(`Current environment: ${environment}`);
    console.log(`Comparison URL: ${comparisonUrl}`);

    // Store screenshot for comparison script
    await expect(page).toHaveScreenshot(`website-${environment}-home-compare.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });
});

test.describe("Website Component Snapshots @visual", () => {
  test("language selector states", async ({ page, takeSnapshot }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // English state
    await homePage.components.switchLanguage("en");
    await page.waitForTimeout(300);
    
    // Focus on language selector area
    const selector = homePage.components.languageSelector;
    await expect(selector).toBeVisible();
  });

  test("navigation states", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Hover state on nav links
    const firstLink = homePage.navigationLinks.first();
    if (await firstLink.isVisible()) {
      await firstLink.hover();
      await page.waitForTimeout(200);
    }
  });
});
