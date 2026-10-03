import { expect, seedMember, test } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";

/**
 * Viewer access to shared member assessments.
 */

test.describe("Ladders viewer assessment @viewer", () => {
  test("a viewer can access a member's view link", async ({ data, page }) => {
    const member = await seedMember(data, uniqueName("E2E Viewer"));

    // Enable the view link
    await data.setViewEnabled(member.id, true);

    // Navigate to the view page using the direct URL - this is basic access
    const app = new LaddersApp(page);
    await app.goto(`/#/v/${member.view_token}`);

    // Should navigate successfully to the page
    await expect(page).toHaveURL(/\/v\//);
  });
});
