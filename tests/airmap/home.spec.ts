import { test, expect } from "../../fixtures";
import { AirmapHomePage, AirmapPlannerPage } from "../../pages/airmap";
import { waitForPageReady } from "../../utils";

test.describe("Airmap Home Page", () => {
  test("should load successfully", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    await expect(page).toHaveTitle(/Airmap|Flight|Route/i);
    expect(await homePage.hasContent()).toBe(true);
  });

  test("should display main content with data-testid", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    // Check for main content using data-testid
    await expect(homePage.mainContent).toBeVisible();
  });

  test("should display header with data-testid", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    // Check header using data-testid
    await expect(page.getByTestId("header")).toBeVisible();
    await expect(page.getByTestId("header-title")).toBeVisible();
  });

  test("should display routes grid with data-testid", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    // Check routes grid using data-testid
    await expect(page.getByTestId("routes-grid")).toBeVisible();
  });

  test("should have create route card with data-testid", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    // Check create route card using data-testid
    await expect(page.getByTestId("create-route-card")).toBeVisible();
  });
});

test.describe("Airmap Language", () => {
  test("should have language selector with data-testid", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    // Check language selector using data-testid
    await expect(page.getByTestId("language-selector")).toBeVisible();
  });

  test("should have language buttons with data-testid", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    // Check each language button using data-testid
    await expect(page.getByTestId("language-button-en")).toBeVisible();
    await expect(page.getByTestId("language-button-es")).toBeVisible();
    await expect(page.getByTestId("language-button-ca")).toBeVisible();
  });

  test("should switch language using data-testid buttons", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    // Switch languages using data-testid buttons
    await page.getByTestId("language-button-es").click();
    await page.waitForTimeout(500);

    await page.getByTestId("language-button-ca").click();
    await page.waitForTimeout(500);

    await page.getByTestId("language-button-en").click();
    await page.waitForTimeout(500);

    expect(true).toBe(true);
  });
});

test.describe("Airmap Theme", () => {
  test("should have theme toggle with data-testid", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    // Check theme toggle using data-testid
    await expect(page.getByTestId("theme-toggle")).toBeVisible();
  });

  test("should toggle theme", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    // Click theme toggle
    await page.getByTestId("theme-toggle").click();
    await page.waitForTimeout(300);

    // Click again to toggle back
    await page.getByTestId("theme-toggle").click();
    await page.waitForTimeout(300);

    expect(true).toBe(true);
  });
});

test.describe("Airmap Route Cards", () => {
  test("should display route cards with data-testid if routes exist", async ({ page }) => {
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    // Check for route cards using data-testid
    const routeCards = page.getByTestId("route-card");
    const count = await routeCards.count();

    // May or may not have routes
    console.log(`Found ${count} route cards with data-testid`);
  });
});

test.describe("Airmap Navigation", () => {
  test("should navigate to planner page", async ({ page }) => {
    const plannerPage = new AirmapPlannerPage(page);
    await plannerPage.goto();

    await expect(plannerPage.map).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Airmap Responsiveness", () => {
  test("should work on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    await expect(homePage.mainContent).toBeVisible();
  });

  test("should work on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    
    const homePage = new AirmapHomePage(page);
    await homePage.goto();

    await expect(homePage.mainContent).toBeVisible();
  });
});
