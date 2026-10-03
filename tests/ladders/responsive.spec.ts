import { test, expect, seedMember } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";

/**
 * Layout across viewports.
 *
 * The app is mostly used on a phone, so the checks here are deliberately about
 * reachability and overflow rather than pixels: everything has to stay tappable
 * and nothing may spill sideways, which is what breaks on narrow screens.
 */

const MOBILE = { width: 375, height: 667 };
const TABLET = { width: 768, height: 1024 };

/** Sideways scroll means a layout bug on the viewport under test. */
async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  // A couple of pixels of slack: sub pixel rounding is not a layout bug.
  expect(overflow).toBeLessThanOrEqual(2);
}

test.describe("Ladders responsive layout", () => {
  test("the home screen stays usable on a phone", async ({ page }) => {
    const app = new LaddersApp(page);
    await page.setViewportSize(MOBILE);
    await app.gotoHome();

    await expect(page.getByTestId("header")).toBeVisible();
    await expect(page.getByTestId("tab-team")).toBeVisible();
    await expect(page.getByTestId("tab-individual")).toBeVisible();
    // The add member action lives per team inside the Team tab.
    await app.openTeamTab();
    await expect(page.getByTestId("add-member-button").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("a member detail stays usable on a phone", async ({ page, data }) => {
    const memberName = uniqueName("E2E Mobile");
    await seedMember(data, memberName);
    const app = new LaddersApp(page);
    await page.setViewportSize(MOBILE);
    await app.gotoHome();

    await app.openTeamMember(memberName);

    await expect(page.getByTestId("assessment-name")).toBeVisible();
    await expect(page.getByTestId("assessment-name")).toBeEditable();
    // Every vertical has to stay reachable and tappable at this width.
    for (const vertical of [
      "Technology",
      "System",
      "People",
      "Process",
      "Influence",
    ]) {
      await page
        .getByTestId(`level-toggle-${vertical}`)
        .scrollIntoViewIfNeeded();
      await expect(page.getByTestId(`level-toggle-${vertical}`)).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
  });

  test("the goals panel stays usable on a phone", async ({ page, data }) => {
    const memberName = uniqueName("E2E MobileGoals");
    await seedMember(data, memberName);
    const app = new LaddersApp(page);
    await page.setViewportSize(MOBILE);
    await app.gotoHome();

    await app.openGoals(memberName);

    await expect(page.getByTestId("goals-panel")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("the tabs and the header survive a tablet", async ({ page }) => {
    const app = new LaddersApp(page);
    await page.setViewportSize(TABLET);
    await app.gotoHome();

    await expect(page.getByTestId("header")).toBeVisible();
    await expect(page.getByTestId("tab-team")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("the reference action stays reachable on a phone", async ({ page }) => {
    const app = new LaddersApp(page);
    await page.setViewportSize(MOBILE);
    await app.gotoHome();

    // The label is hidden on small screens, the control itself is not.
    await page.getByTestId("reference-button").click();
    await expect(page.getByTestId("reference-modal")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
