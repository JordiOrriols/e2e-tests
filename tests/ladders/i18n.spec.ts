import { expect, seedMember, test } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";

/**
 * The language selection persists in user interface elements beyond the home page.
 */

test.describe("Ladders i18n @i18n", () => {
  test("language selector changes the interface language", async ({
    data,
    page,
  }) => {
    const member = await seedMember(data, uniqueName("E2E LanguageSel"));

    const app = new LaddersApp(page);
    await app.gotoHome();

    // Test changing to another language
    await page.getByTestId("language-selector").click();
    await page.getByTestId("language-button-ca").click();

    // Should have changed to Catalan language in the selector
    await expect(page.getByTestId("language-selector")).toContainText("CA");
  });
});
