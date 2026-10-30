import { expect, test } from "@playwright/test";
import { authenticatedPage, signIn } from "../planner/planner-helpers";
import { PROJECTS, expectProjectSwitcher } from "./app-header";

export function projectBrandingTest(
  projectId: (typeof PROJECTS)[number]["id"],
) {
  test("published UI uses the project color on welcome, header and project-menu icons", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    if (!baseURL) throw new Error("Project branding tests require a baseURL");
    const project = PROJECTS.find((entry) => entry.id === projectId)!;
    const anonymous = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    try {
      await anonymous.addInitScript(() =>
        localStorage.setItem("i18nextLng", "en"),
      );
      const page = await anonymous.newPage();
      await page.goto(`${baseURL}/#/`);
      const welcome = page.getByTestId("welcome-page");
      await expect(welcome.locator(`svg.${project.icon}`).first()).toHaveCSS(
        "color",
        project.color,
      );
      await page.getByTestId("welcome-sign-in").click();
      await expect(page.getByTestId("login-email")).toBeVisible();
      await expect(page.getByTestId("login-password")).toBeVisible();
    } finally {
      await anonymous.close();
    }

    const account = await signIn();
    const { page, context } = await authenticatedPage(
      browser,
      account,
      baseURL,
    );
    try {
      const trigger = page.getByRole("button", {
        name: "Switch project",
        exact: true,
      });
      await expect(trigger.locator("svg")).toHaveCSS("color", project.color);
      await expectProjectSwitcher(page, projectId);
      await trigger.click();
      for (const entry of PROJECTS) {
        await expect(
          page
            .getByRole("menuitem", { name: entry.name, exact: true })
            .locator("svg")
            .first(),
        ).toHaveCSS("color", entry.color);
      }
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(trigger).toBeInViewport();
      await expect(trigger.locator("svg")).toHaveCSS("color", project.color);
      await page.screenshot({
        path: test.info().outputPath(`${projectId}-branding-mobile.png`),
      });
    } finally {
      await context.close();
    }
  });
}
