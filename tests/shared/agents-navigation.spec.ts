import { expect, test } from "@playwright/test";
import { authenticatedPage, signIn } from "../planner/planner-helpers";
import { expectProjectSwitcher, PROJECTS } from "./app-header";

test("shared switcher includes Agents on desktop and mobile", async ({
  browser,
  baseURL,
}) => {
  const app = test.info().project.metadata["app"];
  const current = PROJECTS.find((project) => project.id === app);
  if (!current || !baseURL)
    throw new Error("Navigation test requires an app and baseURL");
  const account = await signIn();
  const { page, context } = await authenticatedPage(browser, account, baseURL);
  try {
    const analytics: string[] = [];
    page.on("request", (request) => {
      if (/umami|analytics\.jordiorriols/i.test(request.url()))
        analytics.push(request.url());
    });
    await expectProjectSwitcher(page, current.id);
    await page.setViewportSize({ width: 390, height: 844 });
    const trigger = page.getByRole("button", {
      name: "Switch project",
      exact: true,
    });
    await expect(trigger).toBeInViewport();
    await expectProjectSwitcher(page, current.id);
    expect(analytics).toEqual([]);
  } finally {
    await context.close();
  }
});
