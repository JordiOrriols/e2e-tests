import { test, expect } from "./fixtures";
import { expectProjectSwitcher } from "../shared/app-header";
import { LaddersHomePage } from "../../pages/ladders";

test.describe("Ladders shared header", () => {
  test("switches projects from the app icon and uses the shared tab bar", async ({ page }) => {
    await new LaddersHomePage(page).goto();
    await expectProjectSwitcher(page, "ladders");

    const tabs = page.getByRole("navigation", { name: "Views", exact: true });
    await expect(tabs.getByRole("link")).toHaveText(["Individual", "Team"]);
    await expect(tabs.getByTestId("reference-button")).toBeVisible();
    await tabs.getByRole("link", { name: "Team", exact: true }).click();
    await expect(page).toHaveURL(/view=team/);
    await page.reload();
    await expect(tabs.getByRole("link", { name: "Team", exact: true })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "Individual", exact: true }).click();
    await expect(tabs.getByRole("link", { name: "Individual", exact: true })).toHaveAttribute("aria-current", "page");
    await page.goBack();
    await expect(tabs.getByRole("link", { name: "Team", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByTestId("app-footer")).toHaveCount(1);
  });
});
