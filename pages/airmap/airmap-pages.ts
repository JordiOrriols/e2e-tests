import type { Page, Locator } from "@playwright/test";
import { BasePage, CommonComponents } from "../../pages";

/**
 * Airmap Home Page Object
 */
export class AirmapHomePage extends BasePage {
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

  get header(): Locator {
    return this.page.getByTestId("header").or(
      this.page.locator(".bg-header, header").first()
    );
  }

  get headerTitle(): Locator {
    return this.page.getByTestId("header-title").or(
      this.header.locator("h1")
    );
  }

  get routesGrid(): Locator {
    return this.page.getByTestId("routes-grid");
  }

  get routeCards(): Locator {
    return this.page.getByTestId("route-card").or(this.components.cards);
  }

  get createRouteCard(): Locator {
    return this.page.getByTestId("create-route-card").or(
      this.page.locator('[class*="create-card"], [class*="dashed"]').first()
    );
  }

  get createRouteButton(): Locator {
    return this.page.getByRole("button", { name: /create|new|add/i });
  }

  get mapView(): Locator {
    return this.page.locator('[class*="map"], .mapboxgl-map, .leaflet-container').first();
  }

  get themeToggle(): Locator {
    return this.components.themeToggle;
  }

  // Actions
  async createNewRoute(): Promise<void> {
    const createCard = this.createRouteCard;
    if (await createCard.isVisible()) {
      await createCard.click();
    } else {
      await this.createRouteButton.click();
    }
    await this.page.waitForURL(/planner/);
  }

  async getRouteCount(): Promise<number> {
    return this.routeCards.count();
  }

  async clickRoute(index: number): Promise<void> {
    await this.routeCards.nth(index).click();
  }

  async hasContent(): Promise<boolean> {
    const hasTestIdContent = await this.mainContent.isVisible().catch(() => false);
    if (hasTestIdContent) return true;
    
    const content = await this.page.locator("main, #root, .app").first().textContent().catch(() => null);
    return content !== null && content.length > 0;
  }
}

/**
 * Airmap Planner Page Object
 */
export class AirmapPlannerPage extends BasePage {
  readonly components: CommonComponents;

  constructor(page: Page) {
    super(page);
    this.components = new CommonComponents(page);
  }

  async goto(routeId?: string): Promise<void> {
    const url = routeId ? `/planner?routeId=${routeId}` : "/planner";
    await this.page.goto(url);
    await this.waitForReady();
  }

  get map(): Locator {
    return this.page.locator('[class*="map"], .mapboxgl-map, .leaflet-container').first();
  }

  get waypointList(): Locator {
    return this.page.locator('[class*="waypoint"]');
  }

  get saveButton(): Locator {
    return this.page.getByRole("button", { name: /save/i });
  }

  get routeNameInput(): Locator {
    return this.page.locator('input[name*="name"], input[placeholder*="name"]').first();
  }

  // Actions
  async setRouteName(name: string): Promise<void> {
    await this.routeNameInput.fill(name);
  }

  async addWaypoint(): Promise<void> {
    await this.page.getByRole("button", { name: /add.*waypoint/i }).click();
  }

  async saveRoute(): Promise<void> {
    await this.saveButton.click();
    await this.page.waitForTimeout(500);
  }
}

/**
 * Airmap Tracker Page Object
 */
export class AirmapTrackerPage extends BasePage {
  readonly components: CommonComponents;
  private routeId?: string;

  constructor(page: Page) {
    super(page);
    this.components = new CommonComponents(page);
  }

  async goto(): Promise<void> {
    const url = this.routeId ? `/tracker?routeId=${this.routeId}` : "/tracker";
    await this.page.goto(url);
    await this.waitForReady();
  }

  async gotoWithRoute(routeId: string): Promise<void> {
    this.routeId = routeId;
    await this.page.goto(`/tracker?routeId=${routeId}`);
    await this.waitForReady();
  }

  get map(): Locator {
    return this.page.locator('[class*="map"], .mapboxgl-map, .leaflet-container').first();
  }

  get currentPosition(): Locator {
    return this.page.locator('[class*="position"], [class*="marker"]').first();
  }

  get stats(): Locator {
    return this.page.locator('[class*="stat"]');
  }
}
