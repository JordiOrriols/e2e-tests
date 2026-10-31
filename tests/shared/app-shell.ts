import { expect, type Page } from "@playwright/test";

export async function expectFooterLayout(page: Page, shortPage: boolean) {
  await expect(page.getByTestId("app-footer")).toBeVisible();
  const layout = await page.getByRole("main").evaluate((main) => {
    const footer = document.querySelector('[data-testid="app-footer"]')!.getBoundingClientRect();
    const content = main.getBoundingClientRect();
    return {
      footerBottom: footer.bottom + window.scrollY,
      footerTop: footer.top,
      mainBottom: content.bottom,
      height: window.innerHeight,
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainOverflow: getComputedStyle(main).overflowY,
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.footerTop).toBeGreaterThanOrEqual(layout.mainBottom - 1);
  expect(layout.mainOverflow).not.toMatch(/auto|scroll/);
  if (shortPage) {
    expect(Math.abs(layout.footerBottom - layout.height)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("app-footer")).toBeInViewport();
  } else {
    expect(layout.footerBottom).toBeGreaterThan(layout.height);
    await page.getByTestId("app-footer").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("app-footer")).toBeInViewport();
  }
}
