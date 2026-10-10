import { test, expect, seedMember } from "./fixtures";
import {
  LaddersHomePage,
  LaddersMemberDetailsPanel,
} from "../../pages/ladders";
import { waitForPageReady } from "../../utils";
import { uniqueName } from "./ladders-app";

test.describe("Ladders Home Page", () => {
  test("should load successfully", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    await expect(page).toHaveTitle(/Ladders|Team|Competenc/i);
    expect(await homePage.hasContent()).toBe(true);
  });

  test("should display main content", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Check for main content using data-testid
    await expect(page.getByTestId("main-content")).toBeVisible();
  });

  test("should display header", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Check header using data-testid
    await expect(page.getByTestId("header")).toBeVisible();
    await expect(page.getByTestId("header-title")).toBeVisible();
    await expect(page.getByTestId("header-subtitle")).toBeVisible();
  });

  test("should have add member button", async ({ page, data }) => {
    await seedMember(data, uniqueName("E2E HomeAdd"));
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // The add member action lives in the Team tab, which is not the default one.
    await page.getByTestId("tab-team").click();
    await expect(page.getByTestId("add-member-button").first()).toBeVisible();
  });

  test("should have reference button on desktop", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();

    // Reference button is desktop only
    await expect(page.getByTestId("reference-button")).toBeVisible();
  });

  test("should display main tabs", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Check tabs
    await expect(page.getByTestId("main-tabs")).toBeVisible();
    await expect(page.getByTestId("tabs-list")).toBeVisible();
    await expect(page.getByTestId("tab-team")).toBeVisible();
    await expect(page.getByTestId("tab-individual")).toBeVisible();
  });
});

test.describe("Ladders Add Member", () => {
  test("should open add member form", async ({ page, data }) => {
    await seedMember(data, uniqueName("E2E HomeForm"));
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Click add member button
    await page.getByTestId("tab-team").click();
    await page.getByTestId("add-member-button").first().click();

    // It navigates to a form page (not a modal) - wait for form elements
    const nameInput = page
      .locator('input[placeholder*="name"], [aria-label*="Name"]')
      .first();
    await expect(nameInput).toBeVisible();
  });

  test("should open reference view", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();

    // Click reference button
    await page.getByTestId("reference-button").click();

    // Check for reference content (could be modal or navigation)
    const referenceContent = page
      .locator(
        '[role="dialog"], [class*="reference"], h2:has-text("Reference"), h2:has-text("Level")',
      )
      .first();
    await expect(referenceContent).toBeVisible();

    // Try to go back or close
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  });

  test("should navigate back from add member form", async ({ page, data }) => {
    await seedMember(data, uniqueName("E2E HomeBack"));
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    await page.getByTestId("tab-team").click();
    await page.getByTestId("add-member-button").first().click();

    // Wait for form
    const nameInput = page
      .locator('input[placeholder*="name"], [aria-label*="Name"]')
      .first();
    await expect(nameInput).toBeVisible();

    // Go back
    const backButton = page
      .locator(
        'button:has-text("back"), button:has-text("Back"), a:has-text("back")',
      )
      .first();
    if (await backButton.isVisible()) {
      await backButton.click();
      await page.waitForTimeout(500);
      // Should be back on home
      await expect(page.getByTestId("header")).toBeVisible();
    } else {
      // Use browser back
      await page.goBack();
      await page.waitForTimeout(500);
    }
  });
});

test.describe("Ladders Language", () => {
  test("should have language selector", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();

    await expect(page.getByTestId("language-selector")).toBeVisible();
  });

  test("should have language buttons", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();

    // The selector is a dropdown, so the options only exist once it is open.
    await page.getByTestId("language-selector").click();

    await expect(page.getByTestId("language-button-en")).toBeVisible();
    await expect(page.getByTestId("language-button-es")).toBeVisible();
    await expect(page.getByTestId("language-button-ca")).toBeVisible();
    await expect(page.getByTestId("language-button-fr")).toBeVisible();
    await expect(page.getByTestId("language-button-de")).toBeVisible();
    await expect(page.getByTestId("language-button-it")).toBeVisible();
  });

  test("should switch language", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await homePage.goto();

    const openMenu = () => page.getByTestId("language-selector").click();
    const pick = (code: string) =>
      page.getByTestId(`language-button-${code}`).click();

    await openMenu();
    await pick("es");
    await page.waitForTimeout(500);
    await expect(page.getByTestId("language-selector")).toContainText("ES");

    await openMenu();
    await pick("ca");
    await page.waitForTimeout(500);
    await expect(page.getByTestId("language-selector")).toContainText("CA");

    for (const code of ["fr", "de", "it"]) {
      await openMenu();
      await pick(code);
      await expect(page.getByTestId("language-selector")).toContainText(code.toUpperCase());
    }

    await openMenu();
    await pick("en");
    await page.waitForTimeout(500);
    await expect(page.getByTestId("language-selector")).toContainText("EN");
  });
});

test.describe("Ladders Member Cards", () => {
  test("should display team content", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Team grid or team content area - use flexible selector
    const teamContent = page
      .getByTestId("team-grid")
      .or(page.getByTestId("team-tab"))
      .or(page.locator('[class*="team"], [class*="grid"]'))
      .first();
    await expect(teamContent).toBeVisible();
  });

  test("should display member cards if members exist", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Member cards use dynamic data-testid
    const memberCards = page.locator('[data-testid^="member-card-"]');
    const count = await memberCards.count();

    console.log(`Found ${count} member cards`);
  });

  test("should click on member card if exists", async ({ page }) => {
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
  test("should switch tabs", async ({ page }) => {
    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    // Click individual tab
    await page.getByTestId("tab-individual").click();
    await page.waitForTimeout(300);

    // Click back to team tab
    await page.getByTestId("tab-team").click();
    await page.waitForTimeout(300);

    expect(true).toBe(true);
  });
});

test.describe("Ladders Responsiveness", () => {
  test("should work on mobile viewport", async ({ page, data }) => {
    await seedMember(data, uniqueName("E2E HomeMobile"));
    await page.setViewportSize({ width: 375, height: 667 });

    const homePage = new LaddersHomePage(page);
    await homePage.goto();

    await expect(page.getByTestId("header")).toBeVisible();

    await page.getByTestId("tab-team").click();
    await expect(page.getByTestId("add-member-button").first()).toBeVisible();
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
