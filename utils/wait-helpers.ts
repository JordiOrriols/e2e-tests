import type { Page } from "@playwright/test";

/**
 * Wait for the page to be fully loaded and stable
 */
export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle");
  
  // Wait for fonts to load
  await page.evaluate(() => document.fonts.ready);
  
  // Wait for any CSS transitions to complete
  await page.waitForTimeout(300);
}

/**
 * Wait for a specific element to be stable (no layout shifts)
 */
export async function waitForElementStable(
  page: Page,
  selector: string,
  timeout = 5000
): Promise<void> {
  const element = page.locator(selector);
  await element.waitFor({ state: "visible", timeout });
  
  // Wait for layout to stabilize
  let lastBoundingBox = await element.boundingBox();
  let stable = false;
  const startTime = Date.now();
  
  while (!stable && Date.now() - startTime < timeout) {
    await page.waitForTimeout(100);
    const currentBoundingBox = await element.boundingBox();
    
    if (
      lastBoundingBox &&
      currentBoundingBox &&
      lastBoundingBox.x === currentBoundingBox.x &&
      lastBoundingBox.y === currentBoundingBox.y &&
      lastBoundingBox.width === currentBoundingBox.width &&
      lastBoundingBox.height === currentBoundingBox.height
    ) {
      stable = true;
    }
    
    lastBoundingBox = currentBoundingBox;
  }
}

/**
 * Wait for all images to load
 */
export async function waitForImages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const images = Array.from(document.querySelectorAll("img"));
    await Promise.all(
      images
        .filter(img => !img.complete)
        .map(
          img =>
            new Promise(resolve => {
              img.addEventListener("load", resolve);
              img.addEventListener("error", resolve);
            })
        )
    );
  });
}

/**
 * Wait for animations to complete
 */
export async function waitForAnimations(page: Page): Promise<void> {
  await page.evaluate(() => {
    return Promise.all(
      document.getAnimations().map(animation => animation.finished)
    );
  });
}

/**
 * Scroll to bottom and back to trigger lazy loading
 */
export async function scrollFullPage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>(resolve => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 50);
    });
  });
  
  await page.waitForTimeout(500);
}
