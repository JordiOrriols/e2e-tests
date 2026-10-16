import { test, expect } from "./fixtures";
import { expectProjectSwitcher } from "../shared/app-header";
import { LaddersHomePage } from "../../pages/ladders";

test.describe("Ladders shared header", () => {
  test("switches projects from the app icon and uses the shared tab bar", async ({ page }) => {
    await new LaddersHomePage(page).goto();
    await expectProjectSwitcher(page, "ladders");

    const tabs = page.getByRole("navigation", { name: "Views", exact: true });
    await expect(tabs.getByRole("tab")).toHaveText(["Individual", "Team"]);
    await expect(tabs.getByTestId("reference-button")).toBeVisible();
    await tabs.getByRole("tab", { name: "Team", exact: true }).click();
    await expect(tabs.getByRole("tab", { name: "Team", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(tabs.getByRole("tab", { name: "Individual", exact: true })).toHaveAttribute("aria-selected", "false");
  });
});
