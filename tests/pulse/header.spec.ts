import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { expectProjectSwitcher } from "../shared/app-header";
import { PULSE_URL, openPulse, signIn } from "./pulse-helpers";

/** Sections still waiting for their own page show the shared placeholder. */
const SECTIONS = [
  { tab: "Overview", path: "#/", placeholder: true },
  { tab: "Team Pulse", path: "#/team-pulse", placeholder: false },
  { tab: "Retrospectives", path: "#/retrospectives", placeholder: true },
  { tab: "Actions", path: "#/actions", placeholder: true },
];

test.describe("Pulse shared header", () => {
  let page: Page;
  let context: BrowserContext;
  test.beforeEach(async ({ browser }) => {
    ({ page, context } = await openPulse(browser, await signIn()));
  });
  test.afterEach(async () => { await context.close(); });

  test("switches projects from the app icon", async () => {
    await expect(page.getByRole("banner").getByRole("heading", { name: "Pulse", level: 1 })).toBeVisible();
    await expectProjectSwitcher(page, "pulse");
  });

  test("navigates every section from the shared tab bar", async () => {
    const tabs = page.getByRole("navigation", { name: "Pulse pages" });
    await expect(tabs.getByRole("link")).toHaveText(SECTIONS.map(section => section.tab));

    for (const section of SECTIONS) {
      await tabs.getByRole("link", { name: section.tab, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${section.path.replace("/", "\\/")}$`));
      await expect(page.getByRole("main").getByRole("heading", { name: section.tab, level: 1 })).toBeVisible();
      await expect(page.getByText("Nothing here yet")).toHaveCount(section.placeholder ? 1 : 0);
    }
  });

  test("sends unknown routes to the overview", async () => {
    await page.goto(`${PULSE_URL}/#/does-not-exist`);
    await expect(page.getByRole("main").getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  });
});
