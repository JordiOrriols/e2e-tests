import { test as base, expect, Page, Locator } from "@playwright/test";
import type { ProjectName, Environment } from "../playwright.config";

/**
 * Extended test fixture with custom utilities
 */
export interface TestFixtures {
  /** Current project name */
  projectName: ProjectName;
  /** Current environment */
  environment: Environment;
  /** Wait for page to be fully loaded */
  waitForPageReady: () => Promise<void>;
  /** Take a full page screenshot with consistent naming */
  takeSnapshot: (name: string) => Promise<void>;
  /** Get the comparison URL for the other environment */
  getComparisonUrl: (path?: string) => string;
}

export const test = base.extend<TestFixtures>({
  projectName: async ({ }, use, testInfo) => {
    const metadata = testInfo.project.metadata as { project?: ProjectName };
    await use(metadata?.project ?? "website");
  },

  environment: async ({ }, use, testInfo) => {
    const metadata = testInfo.project.metadata as { environment?: Environment };
    await use(metadata?.environment ?? "localhost");
  },

  waitForPageReady: async ({ page }, use) => {
    const waitForPageReady = async () => {
      await page.waitForLoadState("networkidle");
      // Wait for any animations to complete
      await page.waitForTimeout(500);
      // Ensure fonts are loaded
      await page.evaluate(() => document.fonts.ready);
    };
    await use(waitForPageReady);
  },

  takeSnapshot: async ({ page }, use, testInfo) => {
    const takeSnapshot = async (name: string) => {
      const projectName = (testInfo.project.metadata as { project?: string })?.project ?? "unknown";
      const environment = (testInfo.project.metadata as { environment?: string })?.environment ?? "unknown";
      const snapshotName = `${projectName}-${environment}-${name}.png`;
      
      await expect(page).toHaveScreenshot(snapshotName, {
        fullPage: true,
        animations: "disabled",
      });
    };
    await use(takeSnapshot);
  },

  getComparisonUrl: async ({ baseURL }, use, testInfo) => {
    const getComparisonUrl = (path: string = "") => {
      const metadata = testInfo.project.metadata as { 
        project?: ProjectName; 
        environment?: Environment 
      };
      const project = metadata?.project ?? "website";
      const currentEnv = metadata?.environment ?? "localhost";
      
      // Import project configs dynamically
      const configs: Record<string, { localhost: string; production: string }> = {
        website: {
          localhost: "http://localhost:5173",
          production: "https://www.jordiorriols.cat",
        },
        airmap: {
          localhost: "http://localhost:5174",
          production: "https://airmap.jordiorriols.cat",
        },
        ladders: {
          localhost: "http://localhost:5175",
          production: "https://ladders.jordiorriols.cat",
        },
      };
      
      const otherEnv = currentEnv === "localhost" ? "production" : "localhost";
      return `${configs[project][otherEnv]}${path}`;
    };
    await use(getComparisonUrl);
  },
});

export { expect };
export type { Page, Locator };
