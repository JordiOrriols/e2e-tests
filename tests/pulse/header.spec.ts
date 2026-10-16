import { test, expect } from "@playwright/test";
import { expectProjectSwitcher } from "../shared/app-header";

const SECTIONS = [
  { tab: "Overview", path: "#/" },
  { tab: "Team Pulse", path: "#/team-pulse" },
  { tab: "Retrospectives", path: "#/retrospectives" },
  { tab: "Actions", path: "#/actions" },
];

test.describe("Pulse shared header", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("i18nextLng")) localStorage.setItem("i18nextLng", "en");
    });
  });

  test("switches projects from the app icon", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("heading", { name: "Pulse", level: 1 })).toBeVisible();
    await expectProjectSwitcher(page, "pulse");
  });

  test("navigates every section from the shared tab bar", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "Pulse pages" });
    await expect(tabs.getByRole("link")).toHaveText(SECTIONS.map(section => section.tab));

    for (const section of SECTIONS) {
      await tabs.getByRole("link", { name: section.tab, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${section.path.replace("/", "\\/")}$`));
      await expect(page.getByRole("main").getByRole("heading", { name: section.tab, level: 1 })).toBeVisible();
      await expect(page.getByText("Nothing here yet")).toBeVisible();
    }
  });

  test("sends unknown routes to the overview", async ({ page }) => {
    await page.goto("/#/does-not-exist");
    await expect(page.getByRole("main").getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  });
});
