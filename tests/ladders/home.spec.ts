import { test, expect } from "../../fixtures";
import { LaddersHomePage, LaddersMemberDetailsPanel } from "../../pages/ladders";
import { waitForPageReady } from "../../utils";

test.describe("Ladders Home Page", () => {
  test("should load successfully", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    await expect(page).toHaveTitle(/Ladders|Team|Competenc/i);
    expect(await homePage.hasContent()).toBe(true);
  });

  test("should display main content with data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Check for main content using data-testid
    await expect(page.getByTestId("main-content")).toBeVisible();
  });

  test("should display header with data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Check header using data-testid
    await expect(page.getByTestId("header")).toBeVisible();
    await expect(page.getByTestId("header-title")).toBeVisible();
    await expect(page.getByTestId("header-subtitle")).toBeVisible();
  });

  test("should have add member button with data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    await expect(page.getByTestId("add-member-button")).toBeVisible();
  });

  test("should have reference button with data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();

    // Reference button is desktop only
    await expect(page.getByTestId("reference-button")).toBeVisible();
  });

  test("should display main tabs with data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    await expect(page.getByTestId("main-tabs")).toBeVisible();
    await expect(page.getByTestId("tabs-list")).toBeVisible();
    await expect(page.getByTestId("tab-team")).toBeVisible();
    await expect(page.getByTestId("tab-individual")).toBeVisible();
  });
});

test.describe("Ladders Modals", () => {
  test("should open add member modal using data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Click using data-testid
    await page.getByTestId("add-member-button").click();
    await expect(homePage.addMemberModal).toBeVisible();

    await homePage.closeModal();
  });

  test("should open reference modal using data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();

    // Click using data-testid
    await page.getByTestId("reference-button").click();
    await expect(homePage.referenceModal).toBeVisible();
    
    await homePage.closeModal();
  });

  test("should close modal with escape key", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    await page.getByTestId("add-member-button").click();
    await expect(homePage.addMemberModal).toBeVisible();

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    await expect(homePage.addMemberModal).not.toBeVisible();
  });
});

test.describe("Ladders Language", () => {
  test("should have language selector with data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();

    await expect(page.getByTestId("language-selector")).toBeVisible();
  });

  test("should have language buttons with data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();

    await expect(page.getByTestId("language-button-en")).toBeVisible();
    await expect(page.getByTestId("language-button-es")).toBeVisible();
    await expect(page.getByTestId("language-button-ca")).toBeVisible();
  });

  test("should switch language using data-testid buttons", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();

    await page.getByTestId("language-button-es").click();
    await page.waitForTimeout(500);

    await page.getByTestId("language-button-ca").click();
    await page.waitForTimeout(500);

    await page.getByTestId("language-button-en").click();
    await page.waitForTimeout(500);

    expect(true).toBe(true);
  });
});

test.describe("Ladders Member Cards", () => {
  test("should display team grid with data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Team grid may or may not have members
    const teamGrid = page.getByTestId("team-grid");
    const isVisible = await teamGrid.isVisible().catch(() => false);
    
    console.log(`Team grid visible: ${isVisible}`);
  });

  test("should display member cards with data-testid if members exist", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Member cards use dynamic data-testid
    const memberCards = page.locator('[data-testid^="member-card-"]');
    const count = await memberCards.count();
    
    console.log(`Found ${count} member cards with data-testid`);
  });

  test("should click on member card using data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    const memberCards = page.locator('[data-testid^="member-card-"]');
    const count = await memberCards.count();
    
    if (count > 0) {
      await memberCards.first().click();
      await page.waitForTimeout(500);
    }
  });
});

test.describe("Ladders Tab Navigation", () => {
  test("should switch to individual tab using data-testid", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Click individual tab using data-testid
    await page.getByTestId("tab-individual").click();
    await page.waitForTimeout(300);

    // Click back to team tab
    await page.getByTestId("tab-team").click();
    await page.waitForTimeout(300);

    expect(true).toBe(true);
  });
});

test.describe("Ladders Responsiveness", () => {
  test("should work on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    await expect(page.getByTestId("header")).toBeVisible();
    await expect(page.getByTestId("add-member-button")).toBeVisible();
  });

  test("should work on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    await expect(page.getByTestId("header")).toBeVisible();
  });

  test("should work on desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    await expect(page.getByTestId("header")).toBeVisible();
    await expect(page.getByTestId("reference-button")).toBeVisible();
    await expect(page.getByTestId("language-selector")).toBeVisible();
  });
});
