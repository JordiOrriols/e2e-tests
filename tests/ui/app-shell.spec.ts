import { test, expect } from "@playwright/test";

test("shared shell preserves navigation, language and caller-owned account callbacks at desktop and mobile widths", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/iframe.html?id=views-appshell--workspace&viewMode=story");
    await expect(page.getByRole("main")).toContainText("Workspace content");
    await expect(page.getByRole("navigation", { name: "Planner pages" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Workspace", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Vacations", exact: true })).toHaveAttribute("href", "#vacations");
    await page.getByRole("button", { name: "Language", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitemradio", { name: "Français" }).click();
    await expect(page.getByRole("button", { name: "Language", exact: true })).toContainText("FR");
    await expect(page.getByRole("link", { name: "Contribuer sur GitHub" })).toHaveAttribute("href", "https://github.com/JordiOrriols/planner");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      footerBottom: document.querySelector("footer")!.getBoundingClientRect().bottom,
      height: window.innerHeight,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    expect(Math.abs(geometry.footerBottom - geometry.height)).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test("shell keeps the footer after long content and supports full-width main without nested scrolling", async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/iframe.html?id=views-appshell--long-content&viewMode=story");
    await expect(page.getByText("Feature 40", { exact: true })).toBeVisible();
    const layout = await page.getByRole("main").evaluate((main) => ({
      mainBottom: main.getBoundingClientRect().bottom,
      footerTop: document.querySelector("footer")!.getBoundingClientRect().top,
      scrollHeight: main.scrollHeight,
      clientHeight: main.clientHeight,
      footerTopAtLoad: document.querySelector("footer")!.getBoundingClientRect().top,
    }));
    expect(layout.footerTopAtLoad).toBeGreaterThan(viewport.height);
    expect(layout.footerTop).toBeGreaterThanOrEqual(layout.mainBottom - 1);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1);
    await page.getByTestId("app-footer").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("app-footer")).toBeInViewport();
    await expect(page.getByTestId("app-footer")).toContainText("Made with love by Jordi Orriols");
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/iframe.html?id=views-appshell--full-width&viewMode=story");
  await expect(page.getByRole("main")).toHaveClass(/max-w-none/);
  const width = await page.getByRole("main").evaluate((main) => main.getBoundingClientRect().width);
  expect(width).toBe(1600);
});
