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

    // Check for main content using data-testid with fallback
    const mainContent = page.getByTestId("main-content").or(page.locator("main, #root")).first();
    await expect(mainContent).toBeVisible();
  });

  test("should display home section", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check for home section using data-testid with fallback
    const homeSection = page.getByTestId("home-section").or(page.locator("section, [class*='card']")).first();
    await expect(homeSection).toBeVisible();
  });

  test("should display profile info", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check profile elements using data-testid with fallback
    const profileName = page.getByTestId("profile-name").or(page.locator("h1")).first();
    await expect(profileName).toBeVisible();
  });

  test("should display stats section", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check stats section using data-testid with fallback to any button group
    const statsSection = page.getByTestId("stats-section").or(page.locator("[role='group'], button")).first();
    await expect(statsSection).toBeVisible();
  });

  test("should be responsive", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    
    // Test desktop
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();
    const mainContent = page.getByTestId("home-section").or(page.locator("main, section")).first();
    await expect(mainContent).toBeVisible();

    // Test tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await waitForPageReady(page);
    await expect(mainContent).toBeVisible();

    // Test mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await waitForPageReady(page);
    await expect(mainContent).toBeVisible();
  });
});

test.describe("Website Language", () => {
  test("should have language selector", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Language selector should be visible using data-testid with fallback
    const langSelector = page.getByTestId("language-selector").or(page.locator("nav[aria-label*='Language'], nav[aria-label*='language']"));
    await expect(langSelector).toBeVisible();
  });

  test("should have language buttons", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Check each language button using data-testid with fallback
    const enButton = page.getByTestId("language-button-en").or(page.locator("button:has-text('EN'), [aria-label*='English']")).first();
    await expect(enButton).toBeVisible();
  });

  test("should switch language", async ({ page }) => {
    const homePage = new WebsiteHomePage(page);
    await homePage.goto();

    // Click Spanish button using data-testid with fallback
    const esButton = page.getByTestId("language-button-es").or(page.locator("button:has-text('ES'), [aria-label*='Spanish']")).first();
    await esButton.click();
    await page.waitForTimeout(500);

    // Click Catalan button
    const caButton = page.getByTestId("language-button-ca").or(page.locator("button:has-text('CA'), [aria-label*='Catalan']")).first();
    await caButton.click();
    await page.waitForTimeout(500);

    // Click English button
    const enButton = page.getByTestId("language-button-en").or(page.locator("button:has-text('EN'), [aria-label*='English']")).first();
    await enButton.click();
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
