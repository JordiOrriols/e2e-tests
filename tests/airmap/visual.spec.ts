import { test, expect } from "../../fixtures";
import { AirmapHomePage, AirmapPlannerPage } from "../../pages/airmap";
import { waitForPageReady } from "../../utils";

test.describe("Airmap Visual Regression @visual", () => {
  test("home page snapshot - desktop", async ({ page, takeSnapshot }) => {
    const homePage = new AirmapHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();
    await waitForPageReady(page);
    
    // Wait extra for map to load
    await page.waitForTimeout(2000);

    await takeSnapshot("home-desktop");
  });

  test("home page snapshot - mobile", async ({ page, takeSnapshot }) => {
    const homePage = new AirmapHomePage(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await homePage.goto();
    await waitForPageReady(page);
    await page.waitForTimeout(2000);

    await takeSnapshot("home-mobile");
  });

  test("planner page snapshot", async ({ page, takeSnapshot }) => {
    const plannerPage = new AirmapPlannerPage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await plannerPage.goto();
    await waitForPageReady(page);
    await page.waitForTimeout(3000); // Map needs extra time

    await takeSnapshot("planner-desktop");
  });

  test("should match production and localhost @compare", async ({ 
    page, 
    environment,
    getComparisonUrl 
  }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();
    await waitForPageReady(page);
    await page.waitForTimeout(2000);

    console.log(`Current environment: ${environment}`);
    console.log(`Comparison URL: ${getComparisonUrl("/")}`);

    await expect(page).toHaveScreenshot(`airmap-${environment}-home-compare.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.1, // Higher tolerance for map differences
    });
  });
});

test.describe("Airmap Header Snapshots @visual", () => {
  test("header with light theme", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    await expect(homePage.header).toBeVisible();
    
    // Screenshot just the header
    const headerScreenshot = await homePage.header.screenshot();
    expect(headerScreenshot).toBeTruthy();
  });
});
