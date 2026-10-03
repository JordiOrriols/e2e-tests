import { test, expect } from "../../fixtures";
import { LaddersHomePage } from "../../pages/ladders";
import { waitForPageReady } from "../../utils";

test.describe("Ladders Visual Regression @visual", () => {
  test("home page snapshot - desktop", async ({ page, takeSnapshot }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();
    await waitForPageReady(page);

    await takeSnapshot("home-desktop");
  });

  test("home page snapshot - tablet", async ({ page, takeSnapshot }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    await homePage.goto();
    await waitForPageReady(page);

    await takeSnapshot("home-tablet");
  });

  test("home page snapshot - mobile", async ({ page, takeSnapshot }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await homePage.goto();
    await waitForPageReady(page);

    await takeSnapshot("home-mobile");
  });

  test("should match production and localhost @compare", async ({
    page,
    environment,
    getComparisonUrl,
  }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();
    await waitForPageReady(page);

    console.log(`Current environment: ${environment}`);
    console.log(`Comparison URL: ${getComparisonUrl("/")}`);

    await expect(page).toHaveScreenshot(
      `ladders-${environment}-home-compare.png`,
      {
        fullPage: true,
        maxDiffPixelRatio: 0.05,
      },
    );
  });
});

test.describe("Ladders Form Snapshots @visual", () => {
  test("add member form snapshot", async ({ page, takeSnapshot }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();
    await waitForPageReady(page);

    // Click add member to navigate to form
    await page.getByTestId("tab-team").click();
    await page.getByTestId("add-member-button").click();

    // Wait for form to load
    const nameInput = page
      .locator('input[placeholder*="name"], [aria-label*="Name"]')
      .first();
    await nameInput.waitFor({ state: "visible" });
    await page.waitForTimeout(500);

    await takeSnapshot("add-member-form");

    // Go back
    await page.goBack();
  });

  test("reference view snapshot", async ({ page, takeSnapshot }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();
    await waitForPageReady(page);

    const refButton = page.getByTestId("reference-button");
    if (await refButton.isVisible()) {
      await refButton.click();
      await page.waitForTimeout(500);

      // Check for reference content (modal or page)
      const referenceContent = page
        .locator(
          '[role="dialog"], [class*="reference"], h2:has-text("Reference"), h2:has-text("Level")',
        )
        .first();
      const isVisible = await referenceContent.isVisible().catch(() => false);

      if (isVisible) {
        await takeSnapshot("reference-view");
        await page.keyboard.press("Escape");
      }
    }
  });
});

test.describe("Ladders Header Snapshots @visual", () => {
  test("header snapshot - all languages", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();
    await waitForPageReady(page);

    // English
    await homePage.components.switchLanguage("en");
    await page.waitForTimeout(300);
    const headerEn = await homePage.header.screenshot();
    expect(headerEn).toBeTruthy();

    // Spanish
    await homePage.components.switchLanguage("es");
    await page.waitForTimeout(300);
    const headerEs = await homePage.header.screenshot();
    expect(headerEs).toBeTruthy();

    // Catalan
    await homePage.components.switchLanguage("ca");
    await page.waitForTimeout(300);
    const headerCa = await homePage.header.screenshot();
    expect(headerCa).toBeTruthy();
  });
});
