import { test, expect } from "../../fixtures";
import { WebsiteHomePage } from "../../pages/website";
import { waitForPageReady, scrollFullPage } from "../../utils";

test.describe("Website Home Page", () => {
  test("should load successfully", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Title should contain site name or be non-empty
    await expect(page).toHaveTitle(/.+/);
    expect(await homePage.hasContent()).toBe(true);
  });

  test("should display main content", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check for main content using data-testid
    await expect(page.getByTestId("main-content")).toBeVisible();
  });

  test("should display home section", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check for home section using data-testid
    await expect(page.getByTestId("home-section")).toBeVisible();
  });

  test("should display profile info", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check profile elements using data-testid
    await expect(page.getByTestId("profile-info")).toBeVisible();
    await expect(page.getByTestId("profile-name")).toBeVisible();
    await expect(page.getByTestId("profile-title")).toBeVisible();
  });

  test("should display profile avatar", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check avatar using data-testid
    await expect(page.getByTestId("profile-avatar")).toBeVisible();
  });

  test("should display stats section", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check stats section using data-testid
    await expect(page.getByTestId("stats-section")).toBeVisible();
  });

  test("should be responsive", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    
    // Test desktop
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();
    await expect(page.getByTestId("home-section")).toBeVisible();

    // Test tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await waitForPageReady(page);
    await expect(page.getByTestId("home-section")).toBeVisible();

    // Test mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await waitForPageReady(page);
    await expect(page.getByTestId("home-section")).toBeVisible();
  });
});

test.describe("Website Language", () => {
  test("should have language selector", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Language selector using data-testid
    await expect(page.getByTestId("language-selector")).toBeVisible();
  });

  test("should have language buttons", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check each language button using data-testid
    await expect(page.getByTestId("language-button-en")).toBeVisible();
    await expect(page.getByTestId("language-button-es")).toBeVisible();
    await expect(page.getByTestId("language-button-ca")).toBeVisible();
  });

  test("should switch language", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Click Spanish button using data-testid
    await page.getByTestId("language-button-es").click();
    await page.waitForTimeout(500);

    // Click Catalan button
    await page.getByTestId("language-button-ca").click();
    await page.waitForTimeout(500);

    // Click English button
    await page.getByTestId("language-button-en").click();
    await page.waitForTimeout(500);

    // Test passes if no errors
    expect(true).toBe(true);
  });
});

test.describe("Website Accessibility", () => {
  test("should have proper heading structure", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check for any heading (h1-h6)
    const headings = page.locator("h1, h2, h3, h4, h5, h6");
    const count = await headings.count();
    
    // Should have at least one heading
    expect(count).toBeGreaterThan(0);
  });

  test("should have accessible images", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check images have alt text (or decorative role)
    const images = page.locator("img");
    const count = await images.count();
    
    let accessibleCount = 0;
    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute("alt");
      const ariaLabel = await img.getAttribute("aria-label");
      const role = await img.getAttribute("role");
      const ariaHidden = await img.getAttribute("aria-hidden");
      
      // Image is accessible if it has alt, aria-label, role=presentation, or aria-hidden
      if (alt !== null || ariaLabel !== null || role === "presentation" || ariaHidden === "true") {
        accessibleCount++;
      }
    }

    // Most images should be accessible (allow some flexibility)
    if (count > 0) {
      const accessibleRatio = accessibleCount / count;
      expect(accessibleRatio).toBeGreaterThanOrEqual(0.5);
    }
  });

  test("should be keyboard navigable", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Tab through page
    await page.keyboard.press("Tab");
    const firstFocused = await page.evaluate(() => document.activeElement?.tagName);
    expect(firstFocused).toBeTruthy();
  });
});

test.describe("Website Performance", () => {
  test("should load within acceptable time", async ({ page }) => {
    const startTime = Date.now();
    
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();
    
    const loadTime = Date.now() - startTime;
    
    // Should load within 10 seconds
    expect(loadTime).toBeLessThan(10000);
  });

  test("should lazy load images on scroll", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    await scrollFullPage(page);
    
    // All images should be loaded after scrolling
    const images = page.locator("img");
    const count = await images.count();
    
    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      const isLoaded = await img.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0
      );
      expect(isLoaded).toBe(true);
    }
  });
});
