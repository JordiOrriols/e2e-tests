import type { Page, Locator } from "@playwright/test";
import { BasePage, CommonComponents } from "../../pages";

/**
 * Website Home Page Object
 */
export class WebsiteHomePage extends BasePage {
  readonly components: CommonComponents;

  constructor(page: Page) {
    super(page);
    this.components = new CommonComponents(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/");
    await this.waitForReady();
  }

  // Page-specific locators using data-testid
  get mainContent(): Locator {
    return this.page.getByTestId("main-content");
  }

  get homeSection(): Locator {
    return this.page.getByTestId("home-section");
  }

  get profileInfo(): Locator {
    return this.page.getByTestId("profile-info");
  }

  get profileName(): Locator {
    return this.page.getByTestId("profile-name");
  }

  get profileTitle(): Locator {
    return this.page.getByTestId("profile-title");
  }

  get profileAvatar(): Locator {
    return this.page.getByTestId("profile-avatar");
  }

  get statsSection(): Locator {
    return this.page.getByTestId("stats-section");
  }

  get loadingScreen(): Locator {
    return this.page.getByTestId("loading-screen");
  }

  // Fallback locators for backward compatibility
  get heroSection(): Locator {
    return this.homeSection.or(this.page.locator("main, [class*='hero'], section").first());
  }

  get profileImage(): Locator {
    return this.profileAvatar.or(this.page.locator('img').first());
  }

  get socialLinks(): Locator {
    return this.page.locator('a[href*="github"], a[href*="linkedin"], a[href*="twitter"], a[target="_blank"]');
  }

  get navigationLinks(): Locator {
    return this.page.locator("nav a, header a, a[href^='/']");
  }

  get projectCards(): Locator {
    return this.page.locator('[class*="card"], [class*="project"]');
  }

  get allLinks(): Locator {
    return this.page.locator("a");
  }

  // Actions
  async scrollToProjects(): Promise<void> {
    const cards = this.projectCards;
    if (await cards.count() > 0) {
      await cards.first().scrollIntoViewIfNeeded();
    }
  }

  async clickSocialLink(platform: "github" | "linkedin" | "twitter"): Promise<void> {
    const link = this.page.locator(`a[href*="${platform}"]`).first();
    if (await link.isVisible()) {
      await link.click();
    }
  }

  async hasContent(): Promise<boolean> {
    // Check for testid-based content first, fallback to any content
    const hasTestIdContent = await this.mainContent.isVisible().catch(() => false);
    if (hasTestIdContent) return true;
    
    const content = await this.page.locator("main, #root, .app").first().textContent().catch(() => null);
    return content !== null && content.length > 0;
  }

  async isLoading(): Promise<boolean> {
    return this.loadingScreen.isVisible().catch(() => false);
  }
}

/**
 * Website Projects Page Object (if exists)
 */
export class WebsiteProjectsPage extends BasePage {
  readonly components: CommonComponents;

  constructor(page: Page) {
    super(page);
    this.components = new CommonComponents(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/projects");
    await this.waitForReady();
  }

  get projectList(): Locator {
    return this.components.cards;
  }

  async getProjectCount(): Promise<number> {
    return this.projectList.count();
  }
}

/**
 * Website Contact/About Page Object (if exists)
 */
export class WebsiteAboutPage extends BasePage {
  readonly components: CommonComponents;

  constructor(page: Page) {
    super(page);
    this.components = new CommonComponents(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/about");
    await this.waitForReady();
  }

  get content(): Locator {
    return this.page.locator("main, article").first();
  }
}
