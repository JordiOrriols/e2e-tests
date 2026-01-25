import type { Page, Locator } from "@playwright/test";

/**
 * Common component patterns shared across all projects
 * Prioritizes data-testid selectors with fallbacks for backward compatibility
 */
export class CommonComponents {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Language selector component - uses data-testid with fallback
   */
  get languageSelector(): Locator {
    return this.page.getByTestId("language-selector").or(
      this.page.locator('nav[aria-label="Language selection"]')
    );
  }

  /**
   * Get language button by code using data-testid
   */
  languageButton(code: "en" | "es" | "ca"): Locator {
    return this.page.getByTestId(`language-button-${code}`).or(
      this.languageSelector.getByRole("button", { name: new RegExp(code, "i") })
    );
  }

  /**
   * Switch language
   */
  async switchLanguage(code: "en" | "es" | "ca"): Promise<void> {
    const button = this.languageButton(code);
    if (await button.isVisible()) {
      await button.click();
      await this.page.waitForTimeout(300);
    }
  }

  /**
   * Get current active language
   */
  async getCurrentLanguage(): Promise<string | null> {
    const activeButton = this.languageSelector.locator('[aria-pressed="true"]');
    return activeButton.textContent().catch(() => null);
  }

  /**
   * Theme toggle component - uses data-testid with fallback
   */
  get themeToggle(): Locator {
    return this.page.getByTestId("theme-toggle").or(
      this.page.locator('[aria-label*="theme"], [title*="mode"]')
    );
  }

  /**
   * Modal/Dialog component
   */
  get modal(): Locator {
    return this.page.locator('[role="dialog"]');
  }

  /**
   * Close modal
   */
  async closeModal(): Promise<void> {
    await this.page.keyboard.press("Escape");
    await this.page.waitForTimeout(300);
  }

  /**
   * Header component - uses data-testid with fallback
   */
  get header(): Locator {
    return this.page.getByTestId("header").or(
      this.page.locator("header").first()
    );
  }

  /**
   * Header title
   */
  get headerTitle(): Locator {
    return this.page.getByTestId("header-title").or(
      this.header.locator("h1")
    );
  }

  /**
   * Footer component
   */
  get footer(): Locator {
    return this.page.locator("footer").first();
  }

  /**
   * Primary button
   */
  get primaryButton(): Locator {
    return this.page.locator('button[class*="primary"]').first();
  }

  /**
   * All buttons on the page
   */
  get allButtons(): Locator {
    return this.page.getByRole("button");
  }

  /**
   * All links on the page
   */
  get allLinks(): Locator {
    return this.page.getByRole("link");
  }

  /**
   * All form inputs
   */
  get allInputs(): Locator {
    return this.page.locator("input, textarea, select");
  }

  /**
   * Cards (common UI pattern)
   */
  get cards(): Locator {
    return this.page.locator('[data-testid*="card"], [class*="card"], [data-slot="card"]');
  }
}
