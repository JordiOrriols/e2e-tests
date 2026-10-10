import { randomUUID } from "node:crypto";
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import { DATA_TIMEOUT } from "./fixtures";

/**
 * Helpers shared by the ladders suites.
 *
 * Ladders persists everything in Supabase, so tests that create teams or
 * members must clean up after themselves. Every helper here returns the locator
 * needed to undo the action.
 */

let counter = 0;

/**
 * Unique, readable name so repeated runs never collide.
 *
 * The random part matters as much as the timestamp: workers are separate
 * processes that start their tests in the same millisecond, and a name plus a
 * per process counter collides exactly then.
 */
export function uniqueName(prefix: string): string {
  counter += 1;
  const stamp = Date.now().toString(36).slice(-4);
  const unique = randomUUID().slice(0, 4);
  return `${prefix} ${stamp}${unique}-${counter}`;
}

/** The app uses a HashRouter, so routes live under `#/`. */
export function ladderPath(path: string): string {
  const clean = path.replace(/^\//, "");
  return clean ? `/#/${clean}` : "/#/";
}

export class LaddersApp {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Navigate home and wait until the tabs have rendered. */
  async gotoHome(): Promise<void> {
    await this.page.goto("/");
    await expect(this.page.getByTestId("main-tabs")).toBeVisible();
  }

  /** Opens a hash route directly, for the screens that live outside the tabs. */
  async goto(path: string): Promise<void> {
    await this.page.goto(path);
  }

  get teamTab(): Locator {
    return this.page.getByTestId("tab-team");
  }

  get individualTab(): Locator {
    return this.page.getByTestId("tab-individual");
  }

  async openTeamTab(): Promise<void> {
    await this.teamTab.click();
    await expect(this.page.getByTestId("team-tab")).toBeVisible();
  }

  /**
   * Opens the create/rename dialog, fills it and confirms.
   * Returns the chosen name so the caller can assert or clean up.
   */
  async submitTeamNameDialog(name: string): Promise<void> {
    await this.page
      .getByTestId("team-name-dialog")
      .waitFor({ state: "visible" });
    await this.page.getByTestId("team-name-input").fill(name);
    await this.page.getByTestId("team-name-submit").click();
    await this.page
      .getByTestId("team-name-dialog")
      .waitFor({ state: "hidden" });
  }

  /** Creates a team through the UI and waits for it to appear. */
  async createTeam(name: string): Promise<string> {
    await this.openTeamTab();
    await this.page.getByTestId("team-create-open").first().click();
    await this.submitTeamNameDialog(name);
    await this.expectTeamExists(name);
    return name;
  }

  /**
   * Teams render as sections labelled by their team id, which makes them
   * accessible regions named after the team. The heading filter is kept as a
   * fallback in case that wiring changes.
   */
  teamSectionByName(name: string): Locator {
    const byRegion = this.page.getByRole("region", { name, exact: true });
    const byHeading = this.page
      .locator("section")
      .filter({ has: this.page.getByRole("heading", { name, exact: true }) });
    return byRegion.or(byHeading).first();
  }

  async expectTeamExists(name: string): Promise<void> {
    await expect(this.teamSectionByName(name)).toBeVisible();
  }

  async deleteTeam(name: string): Promise<void> {
    await this.openTeamTab();
    const section = this.teamSectionByName(name);
    await section.getByTestId("team-delete-open").click();
    await this.page.getByTestId("confirm-dialog").waitFor({ state: "visible" });
    await this.page.getByTestId("confirm-dialog-confirm").click();
    await this.page.getByTestId("confirm-dialog").waitFor({ state: "hidden" });
  }

  async renameTeam(oldName: string, newName: string): Promise<void> {
    await this.openTeamTab();
    await this.teamSectionByName(oldName)
      .getByTestId("team-rename-open")
      .click();
    await this.submitTeamNameDialog(newName);
    await this.expectTeamExists(newName);
  }

  /**
   * Moves a member onto a team section using HTML5 drag and drop.
   *
   * The app reads the member id from dataTransfer on drop, so the very same
   * DataTransfer instance has to be reused across dragstart, dragover and drop.
   * Playwright's dragTo cannot do that, and the app exposes no menu alternative,
   * so the events are dispatched directly in the page.
   */
  async dragMemberToTeam(
    memberName: string,
    targetTeamName: string,
  ): Promise<void> {
    const memberId = await this.memberIdByName(memberName);
    const card = await this.page
      .locator(`[data-testid="member-card-${memberId}"]`)
      .elementHandle();
    const target = await this.teamSectionByName(targetTeamName).elementHandle();
    if (!card || !target)
      throw new Error(`Could not resolve drag endpoints for "${memberName}"`);

    await this.page.evaluate(
      ([source, destination, id]) => {
        const dt = new DataTransfer();
        dt.effectAllowed = "move";
        dt.setData("text/member-id", id);
        source.dispatchEvent(
          new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }),
        );
        destination.dispatchEvent(
          new DragEvent("dragover", {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
          }),
        );
        destination.dispatchEvent(
          new DragEvent("drop", {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      [card, target, memberId] as const,
    );
  }

  async memberIdByName(name: string): Promise<string> {
    const testid = await this.page
      .locator('[data-testid^="member-card-"]')
      .filter({
        has: this.page.getByTestId("member-name").filter({ hasText: name }),
      })
      .first()
      .getAttribute("data-testid");
    if (!testid) throw new Error(`No member card found for "${name}"`);
    return testid.replace("member-card-", "");
  }

  /** Publish is gated on the profile autosave settling, so wait for it to enable. */
  async publishMember(): Promise<void> {
    const publish = this.publishButton;
    await expect(publish).toBeEnabled({ timeout: DATA_TIMEOUT });
    const peer = await this.page.getByTestId("assessment-author").isVisible();
    await publish.click();
    if (!peer) {
      await expect(this.page.getByTestId("alert-modal")).toBeVisible();
      await this.page.getByTestId("alert-modal-close").click();
      await expect(this.page.getByTestId("alert-modal")).toBeHidden();
    }
  }

  /**
   * Creates a member through the UI.
   *
   * The publish action only enables once at least one competency level is set,
   * so a bare name is not enough to leave the new-member screen.
   */
  async createMember(name: string, role: string, level = 3): Promise<string> {
    await this.page.goto(ladderPath("member/new"));
    await expect(this.page.getByTestId("assessment-name")).toBeVisible();

    await this.page.getByTestId("assessment-name").fill(name);
    await this.page.getByTestId("assessment-role").fill(role);

    await this.setLevel("Technology", level);
    await this.publishMember();
    await expect(this.page).toHaveURL(/member\/(?!new)/, {
      timeout: DATA_TIMEOUT,
    });

    return this.page.url().split("/member/")[1] ?? "";
  }

  /** Picks a current level for a competency. The first vertical is expanded by default. */
  /** The level buttons only exist once the vertical is expanded. */
  private async revealLevel(vertical: string, level: number): Promise<Locator> {
    const container = this.page.getByTestId(`level-vertical-${vertical}`);
    await container.scrollIntoViewIfNeeded();

    const button = container.getByTestId(`level-current-${vertical}-${level}`);
    if (!(await button.isVisible())) {
      await this.page.getByTestId(`level-toggle-${vertical}`).click();
      await expect(button).toBeVisible();
    }
    return button;
  }

  async setLevel(vertical: string, level: number): Promise<void> {
    await (await this.revealLevel(vertical, level)).click();
  }

  /**
   * Whether a level is the one currently chosen, without changing anything: a
   * form that arrives empty is the point of several tests, and clicking a level
   * to find out would be the opposite of a read only check.
   */
  async levelIsSelected(vertical: string, level: number): Promise<boolean> {
    const button = await this.revealLevel(vertical, level);
    return (await button.getAttribute("data-selected")) === "true";
  }

  /**
   * Member deletion is only reachable from the team tab card, whose action
   * buttons appear on hover.
   */
  async openDeleteConfirm(name: string): Promise<void> {
    const id = await this.memberIdByName(name);
    await this.openTeamTab();
    const card = this.page.locator(`[data-testid="member-card-${id}"]`);
    await card.hover();
    await card.getByTestId(`member-delete-${id}`).click();
    await this.page.getByTestId("confirm-dialog").waitFor({ state: "visible" });
  }

  async cancelDelete(): Promise<void> {
    await this.page.getByTestId("confirm-dialog-cancel").click();
    await this.page.getByTestId("confirm-dialog").waitFor({ state: "hidden" });
  }

  async confirmDelete(): Promise<void> {
    await this.page.getByTestId("confirm-dialog-confirm").click();
    await this.page.getByTestId("confirm-dialog").waitFor({ state: "hidden" });
  }

  async deleteMember(name: string): Promise<void> {
    await this.openDeleteConfirm(name);
    await this.confirmDelete();
  }

  /** Opens the new member screen, optionally scoped to a team via the query param. */
  async gotoNewMember(teamId?: string): Promise<void> {
    const query = teamId ? `?team=${encodeURIComponent(teamId)}` : "";
    await this.page.goto(ladderPath(`member/new${query}`));
    await expect(this.page.getByTestId("assessment-name")).toBeVisible();
  }

  /**
   * The individual tab does not navigate on click: it selects the member and
   * shows the details panel next to the list. Opening the assessment screen is
   * the separate edit action inside that panel.
   */
  async selectMember(name: string): Promise<string> {
    const id = await this.memberIdByName(name);
    await this.page.locator(`[data-testid="member-card-${id}"]`).click();
    await expect(this.page.getByTestId("member-details-name")).toHaveText(name);
    return id;
  }

  /** Selects a member and follows the edit action into the assessment screen. */
  async openMember(name: string): Promise<string> {
    const id = await this.selectMember(name);
    await this.page.getByTestId("member-details-edit").click();
    await expect(this.page).toHaveURL(new RegExp(`/member/${id}$`));
    await expect(this.page.getByTestId("assessment-name")).toBeVisible();
    return id;
  }

  /** Opens a member card from the team tab, which navigates straight away. */
  async openTeamMember(name: string): Promise<string> {
    const id = await this.memberIdByName(name);
    await this.openTeamTab();
    await this.page.locator(`[data-testid="member-card-${id}"]`).click();
    await expect(this.page).toHaveURL(new RegExp(`/member/${id}$`));
    await expect(this.page.getByTestId("assessment-name")).toBeVisible();
    return id;
  }

  /**
   * Opens the goals tab on whichever screen is showing. Both the manager's
   * assessment and the shared view page have one, and the evaluated person needs
   * the same way in from the second one.
   */
  async openGoalsTab(): Promise<void> {
    await this.page.getByTestId("assessment-tab-goals").click();
    await expect(this.page.getByTestId("goals-panel")).toBeVisible();
  }

  /** Goals live on the assessment screen, behind a tab that managers only get. */
  async openGoals(memberName: string): Promise<string> {
    const id = await this.openTeamMember(memberName);
    await this.page.getByTestId("assessment-tab-goals").click();
    await expect(this.page.getByTestId("goal-create-form")).toBeVisible();
    return id;
  }

  async createGoal(input: {
    title: string;
    dueDate?: string;
    description?: string;
  }): Promise<void> {
    await this.page.getByTestId("goal-title-input").fill(input.title);
    if (input.dueDate)
      await this.page.getByTestId("goal-date-input").fill(input.dueDate);
    if (input.description) {
      await this.page
        .getByTestId("goal-description-input")
        .fill(input.description);
    }
    await this.page.getByTestId("goal-create-submit").click();
    await expect(this.goalByTitle(input.title)).toBeVisible();
    // The form resets so the next goal can be typed straight away.
    await expect(this.page.getByTestId("goal-title-input")).toHaveValue("");
  }

  /**
   * Goals are located by their title attribute rather than by text: in manager
   * mode the title lives in an input, and input values are not text content.
   * Both the editable and the read-only article carry the attribute.
   */
  goalByTitle(title: string): Locator {
    return this.page.locator(`[data-goal-title="${title}"]`);
  }

  /**
   * Stable handle for a goal being edited.
   *
   * The title attribute changes as soon as the title input is typed into, so a
   * locator built from the title would detach from the element mid edit. The id
   * does not move.
   */
  async goalIdByTitle(title: string): Promise<string> {
    const id = await this.goalByTitle(title).getAttribute("data-goal-id");
    if (!id) throw new Error(`No goal found for "${title}"`);
    return id;
  }

  goalById(id: string): Locator {
    return this.page.locator(`[data-goal-id="${id}"]`);
  }

  /** The profile autosaves on a debounce, so waits for it to report "saved". */
  async waitForAutosave(): Promise<void> {
    await expect(this.page.getByTestId("assessment-autosave")).toHaveAttribute(
      "data-state",
      "saved",
      { timeout: DATA_TIMEOUT },
    );
  }

  async renameMember(oldName: string, newName: string): Promise<void> {
    await this.openMember(oldName);
    await this.page.getByTestId("assessment-name").fill(newName);
    await this.waitForAutosave();
  }

  /** One entry per version the current screen is allowed to show. */
  async listedVersions(): Promise<{ author: string; status: string }[]> {
    const rows = this.page.getByTestId("version-row");
    const listed: { author: string; status: string }[] = [];
    for (const row of await rows.all()) {
      listed.push({
        author: (await row.getByTestId("version-author").innerText()).trim(),
        status:
          (await row
            .getByTestId("version-status")
            .getAttribute("data-status")) ?? "",
      });
    }
    return listed;
  }

  /** Publish button is present on both self and peer flows, with a mode prefix. */
  get publishButton(): Locator {
    return this.page.locator(
      '[data-testid^="assessment-action-"][data-testid$="_publish"]',
    );
  }

  /* Team sharing */

  get shareDialog(): Locator {
    return this.page.getByTestId("share-team-dialog");
  }

  get shareError(): Locator {
    return this.page.getByTestId("share-error");
  }

  async openShareDialog(teamName: string): Promise<void> {
    await this.page.getByTestId("tab-team").click();
    await this.teamSectionByName(teamName)
      .getByTestId("team-share-open")
      .click();
    await expect(this.shareDialog).toBeVisible();
  }

  async share(email: string, access: "viewer" | "editor"): Promise<void> {
    await this.page.getByTestId("share-email-input").fill(email);
    await this.page.getByTestId("share-access-select").selectOption(access);
    await this.page.getByTestId("share-team-submit").click();
  }

  shareRow(email: string): Locator {
    return this.page
      .locator('[data-testid="share-row"]')
      .filter({ hasText: email });
  }

  async waitForShareRow(email: string): Promise<Locator> {
    const row = this.shareRow(email);
    await expect(row).toBeVisible({ timeout: DATA_TIMEOUT });
    return row;
  }

  async changeShareAccess(
    email: string,
    access: "viewer" | "editor",
  ): Promise<void> {
    await this.shareRow(email)
      .getByTestId("share-row-access")
      .selectOption(access);
  }

  async removeShare(email: string): Promise<void> {
    await this.shareRow(email).getByTestId("share-row-remove").click();
  }

  /* Authentication */

  get welcomePage(): Locator {
    return this.page.getByTestId("welcome-page");
  }

  get loginDialog(): Locator {
    return this.page.getByRole("dialog");
  }

  get loginError(): Locator {
    return this.page.getByTestId("login-error");
  }

  async signOut(): Promise<void> {
    await this.page.getByTestId("sign-out-button").click();
    await expect(this.welcomePage).toBeVisible();
  }

  /** Opens the sign in dialog from the welcome page. */
  async openSignIn(): Promise<void> {
    await this.page.getByTestId("welcome-sign-in").click();
    await expect(this.page.getByTestId("login-email")).toBeVisible();
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.openSignIn();
    await this.page.getByTestId("login-email").fill(email);
    await this.page.getByTestId("login-password").fill(password);
    await this.page.getByTestId("login-submit").click();
  }
}

/**
 * Reads the last alert the app raised.
 *
 * Share and copy actions report through the shared accessible alert modal.
 */
export async function captureNextAlert(
  page: Page,
  action: () => Promise<void>,
): Promise<string> {
  await action();
  const modal = page.getByTestId("alert-modal");
  await expect(modal).toBeVisible();
  const message = await modal.locator('[data-slot="alert-dialog-description"]').innerText();
  await page.getByTestId("alert-modal-close").click();
  await expect(modal).toBeHidden();
  return message;
}

/** Grants clipboard permissions so copy-to-clipboard can be asserted. */
export async function grantClipboard(page: Page): Promise<void> {
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    })
    .catch(() => undefined);
}

export async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}
