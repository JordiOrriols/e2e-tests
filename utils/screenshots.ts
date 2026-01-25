import type { Page } from "@playwright/test";

/**
 * Screenshot utility functions
 */
export interface ScreenshotOptions {
  fullPage?: boolean;
  animations?: "disabled" | "allow";
  mask?: string[];
  maxDiffPixelRatio?: number;
}

/**
 * Take a screenshot with consistent settings
 */
export async function takeScreenshot(
  page: Page,
  name: string,
  options: ScreenshotOptions = {}
): Promise<Buffer> {
  const {
    fullPage = true,
    animations = "disabled",
    mask = [],
  } = options;

  // Disable animations for consistent screenshots
  if (animations === "disabled") {
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `,
    });
  }

  // Wait for fonts and images
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");

  // Mask dynamic elements
  const maskLocators = mask.map(selector => page.locator(selector));

  return page.screenshot({
    fullPage,
    animations,
    mask: maskLocators,
  });
}

/**
 * Compare two screenshots and return difference percentage
 */
export function compareScreenshots(
  baseline: Buffer,
  current: Buffer
): { match: boolean; diffPercentage: number } {
  // Simple byte comparison - for more advanced comparison, use pixelmatch
  const baselineStr = baseline.toString("base64");
  const currentStr = current.toString("base64");
  
  if (baselineStr === currentStr) {
    return { match: true, diffPercentage: 0 };
  }

  // Calculate rough difference
  let diffCount = 0;
  const minLen = Math.min(baselineStr.length, currentStr.length);
  
  for (let i = 0; i < minLen; i++) {
    if (baselineStr[i] !== currentStr[i]) {
      diffCount++;
    }
  }

  const diffPercentage = (diffCount / minLen) * 100;
  return { 
    match: diffPercentage < 1, 
    diffPercentage 
  };
}

/**
 * Get screenshot filename with environment prefix
 */
export function getScreenshotName(
  project: string,
  environment: string,
  pageName: string,
  suffix?: string
): string {
  const parts = [project, environment, pageName];
  if (suffix) {
    parts.push(suffix);
  }
  return `${parts.join("-")}.png`;
}
