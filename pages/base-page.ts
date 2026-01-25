import type { Page, Locator } from "@playwright/test";

/**
 * Base Page Object class with common functionality
 * All page objects should extend this class
 */
export abstract class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to the page path
   */
  abstract goto(): Promise<void>;

  /**
   * Wait for the page to be fully loaded (with fallback for slow connections)
   */
  async waitForReady(): Promise<void> {
    try {
      // Try networkidle first, but with a timeout
      await this.page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch {
      // Fall back to domcontentloaded if networkidle times out
      await this.page.waitForLoadState("domcontentloaded");
    }
    
    // Wait for fonts if supported
    await this.page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    }).catch(() => {});
  }

  /**
   * Get the current URL path
   */
  async getPath(): Promise<string> {
    const url = new URL(this.page.url());
    return url.pathname;
  }

  /**
   * Check if page has loaded without errors
   */
  async hasNoErrors(): Promise<boolean> {
    const errors: string[] = [];
    
    this.page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await this.page.waitForTimeout(1000);
    return errors.length === 0;
  }

  /**
   * Take a screenshot with a descriptive name
   */
  async screenshot(name: string): Promise<Buffer> {
    return this.page.screenshot({
      path: `screenshots/${name}.png`,
      fullPage: true,
    });
  }

  /**
   * Get element by test ID
   */
  getByTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /**
   * Get element by role
   */
  getByRole(
    role: Parameters<Page["getByRole"]>[0],
    options?: Parameters<Page["getByRole"]>[1]
  ): Locator {
    return this.page.getByRole(role, options);
  }

  /**
   * Get element by text
   */
  getByText(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  /**
   * Click element and wait for navigation
   */
  async clickAndWaitForNavigation(locator: Locator): Promise<void> {
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: "networkidle" }),
      locator.click(),
    ]);
  }

  /**
   * Fill form field with label
   */
  async fillByLabel(label: string, value: string): Promise<void> {
    await this.page.getByLabel(label).fill(value);
  }

  /**
   * Select option from dropdown by label
   */
  async selectByLabel(label: string, value: string): Promise<void> {
    await this.page.getByLabel(label).selectOption(value);
  }
}
