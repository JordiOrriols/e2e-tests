import type { Page, Locator } from "@playwright/test";
import { BasePage, CommonComponents } from "../../pages";

/**
 * Ladders Home Page Object
 */
export class LaddersHomePage extends BasePage {
  readonly components: CommonComponents;

  constructor(page: Page) {
    super(page);
    this.components = new CommonComponents(page);
  }

  async goto(): Promise<void> {
    await this.page.goto("/");
    await this.waitForReady();
  }

  // Main content using data-testid
  get mainContent(): Locator {
    return this.page.getByTestId("main-content");
  }

  get mainArea(): Locator {
    return this.page.getByTestId("main-area");
  }

  // Header locators using data-testid
  get header(): Locator {
    return this.page.getByTestId("header").or(
      this.page.locator("header").first()
    );
  }

  get headerTitle(): Locator {
    return this.page.getByTestId("header-title").or(
      this.header.locator("h1")
    );
  }

  get headerSubtitle(): Locator {
    return this.page.getByTestId("header-subtitle");
  }

  get addMemberButton(): Locator {
    return this.page.getByTestId("add-member-button").first();
  }

  get referenceButton(): Locator {
    return this.page.getByTestId("reference-button").first();
  }

  // Tabs using data-testid
  get mainTabs(): Locator {
    return this.page.getByTestId("main-tabs");
  }

  get tabsList(): Locator {
    return this.page.getByTestId("tabs-list").or(
      this.page.locator('[role="tablist"]')
    );
  }

  get teamTab(): Locator {
    return this.page.getByTestId("tab-team");
  }

  get individualTab(): Locator {
    return this.page.getByTestId("tab-individual");
  }

  get tabButtons(): Locator {
    return this.page.locator('[role="tab"]');
  }

  // Team content using data-testid
  get teamTab_content(): Locator {
    return this.page.getByTestId("team-tab");
  }

  get teamGrid(): Locator {
    return this.page.getByTestId("team-grid");
  }

  get teamOverviewTitle(): Locator {
    return this.page.getByTestId("team-overview-title");
  }

  get memberCount(): Locator {
    return this.page.getByTestId("team-member-count");
  }

  get exportTeamButton(): Locator {
    return this.page.getByTestId("export-team-button");
  }

  // Content locators using data-testid
  get memberCards(): Locator {
    return this.page.locator('[data-testid^="member-card-"]');
  }

  get memberList(): Locator {
    return this.page.getByTestId("member-list");
  }

  // Modals
  get addMemberModal(): Locator {
    return this.page.locator('[role="dialog"]').filter({
      hasText: /add.*member|new.*member/i,
    });
  }

  get referenceModal(): Locator {
    return this.page.locator('[role="dialog"]').filter({
      hasText: /reference|level/i,
    });
  }

  // Actions
  async openAddMemberModal(): Promise<void> {
    await this.addMemberButton.click();
    await this.addMemberModal.waitFor({ state: "visible" });
  }

  async openReferenceModal(): Promise<void> {
    await this.referenceButton.click();
    await this.referenceModal.waitFor({ state: "visible" });
  }

  async closeModal(): Promise<void> {
    await this.components.closeModal();
  }

  async getMemberCount(): Promise<number> {
    return this.memberCards.count();
  }

  async switchTab(tabName: string): Promise<void> {
    if (tabName.toLowerCase() === "team") {
      await this.teamTab.click();
    } else if (tabName.toLowerCase() === "individual") {
      await this.individualTab.click();
    } else {
      await this.tabButtons.filter({ hasText: new RegExp(tabName, "i") }).click();
    }
    await this.page.waitForTimeout(300);
  }

  async clickMember(index: number): Promise<void> {
    await this.memberCards.nth(index).click();
  }

  async hasContent(): Promise<boolean> {
    const hasTestIdContent = await this.mainContent.isVisible().catch(() => false);
    if (hasTestIdContent) return true;
    
    const content = await this.page.locator("main, #root, .app").first().textContent().catch(() => null);
    return content !== null && content.length > 0;
  }
}

/**
 * Ladders Member Details Page/Panel Object
 */
export class LaddersMemberDetailsPanel extends BasePage {
  readonly components: CommonComponents;

  constructor(page: Page) {
    super(page);
    this.components = new CommonComponents(page);
  }

  async goto(): Promise<void> {
    // This is typically a panel, not a separate page
    await this.page.goto("/");
    await this.waitForReady();
  }

  get panel(): Locator {
    return this.page.locator('[class*="panel"], [class*="details"]').first();
  }

  get memberName(): Locator {
    return this.panel.locator("h2, h3").first();
  }

  get competencyCards(): Locator {
    return this.panel.locator('[class*="competency"], [class*="card"]');
  }

  get radarChart(): Locator {
    return this.panel.locator("svg, canvas").first();
  }

  async isVisible(): Promise<boolean> {
    return this.panel.isVisible();
  }
}

/**
 * Ladders Self Assessment Page Object
 */
export class LaddersSelfAssessmentPage extends BasePage {
  readonly components: CommonComponents;

  constructor(page: Page) {
    super(page);
    this.components = new CommonComponents(page);
  }

  async goto(memberId?: string): Promise<void> {
    const url = memberId ? `/selfassesment?memberId=${memberId}` : "/selfassesment";
    await this.page.goto(url);
    await this.waitForReady();
  }

  get form(): Locator {
    return this.page.locator("form").first();
  }

  get competencyInputs(): Locator {
    return this.page.locator('input[type="range"], input[type="number"]');
  }

  get submitButton(): Locator {
    return this.page.getByRole("button", { name: /submit|save/i });
  }

  async setCompetencyLevel(competency: string, level: number): Promise<void> {
    const input = this.page.locator(`[name*="${competency}"], [aria-label*="${competency}"]`);
    await input.fill(level.toString());
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
    await this.page.waitForTimeout(500);
  }
}
