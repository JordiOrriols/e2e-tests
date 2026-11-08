import { expect, type Locator, type Page } from "@playwright/test";

export async function expectSingleModalScroll(page: Page, dialog: Locator, footerAction: string, overflowing = false) {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const scroll = dialog.locator(":scope > .overflow-y-auto");
    await expect(scroll).toHaveCount(1);
    const nested = await scroll.evaluate((element) =>
      Array.from(element.querySelectorAll<HTMLElement>("*"))
        .filter((child) => /auto|scroll/.test(getComputedStyle(child).overflowY)
          && child.tagName !== "TEXTAREA").length);
    expect(nested).toBe(0);
    if (overflowing) {
      await expect.poll(() => dialog.evaluate((element) =>
        [element, ...element.querySelectorAll<HTMLElement>("*")]
          .filter((child) => child.tagName !== "TEXTAREA"
            && /auto|scroll/.test(getComputedStyle(child).overflowY)
            && child.scrollHeight > child.clientHeight + 1).length
      )).toBe(1);
    }
    await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByRole("button", { name: footerAction, exact: true })).toBeInViewport();
    expect(await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
    })).toBe(true);
    await scroll.evaluate((element) => { element.scrollTop = 0; });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}
