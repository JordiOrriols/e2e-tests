import { test, expect } from "./fixtures";
import { LaddersApp } from "./ladders-app";

/**
 * The role reference.
 *
 * It is the shared vocabulary behind every level a user picks, so it is worth
 * pinning down that all five verticals and all five levels are there, and that
 * the dialog gets out of the way.
 */

const VERTICALS = ["Technology", "System", "People", "Process", "Influence"];
const LEVELS = [1, 2, 3, 4, 5];

test.describe("Ladders role reference", () => {
  test.beforeEach(async ({ page }) => {
    const app = new LaddersApp(page);
    await app.gotoHome();
    await page.getByTestId("reference-button").click();
    await expect(page.getByTestId("reference-modal")).toBeVisible();
  });

  test("lists every vertical with its five levels", async ({ page }) => {
    for (const vertical of VERTICALS) {
      const section = page.getByTestId(`reference-vertical-${vertical}`);
      await expect(section).toBeVisible();
      for (const level of LEVELS) {
        await expect(
          section.locator(
            `[data-testid="reference-level-${vertical}-${level}"]`,
          ),
        ).toBeVisible();
      }
    }
  });

  test("closes from the close button", async ({ page }) => {
    await page.getByTestId("reference-modal-close").click();
    await expect(page.getByTestId("reference-modal")).toHaveCount(0);
    // The app underneath is still there, not a blank screen.
    await expect(page.getByTestId("header")).toBeVisible();
  });

  test("closes with the escape key", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("reference-modal")).toHaveCount(0);
  });

  test("can be reopened after being closed", async ({ page }) => {
    await page.getByTestId("reference-modal-close").click();
    await expect(page.getByTestId("reference-modal")).toHaveCount(0);

    await page.getByTestId("reference-button").click();
    await expect(page.getByTestId("reference-modal")).toBeVisible();
  });
});
