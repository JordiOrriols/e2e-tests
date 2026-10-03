import { expect, seedMember, test } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";

/**
 * The three links a manager hands out, and what happens when the clipboard says no.
 *
 * Copying is the whole point of this control and the copy is invisible, so every
 * test here reads the clipboard back rather than trusting the confirmation.
 */

const MAIN = "split-button-member_share_self";
const MENU = "split-menu-member_share_self";

/** The alert is the only feedback the control gives, so it is worth reading. */
function watchAlerts(page: import("@playwright/test").Page): string[] {
  const seen: string[] = [];
  page.on("dialog", (dialog) => {
    seen.push(dialog.message());
    void dialog.dismiss();
  });
  return seen;
}

/** Picks a link out of the menu and waits for the copy to land. */
async function copyFromMenu(
  page: import("@playwright/test").Page,
  item: string,
): Promise<void> {
  await page.getByTestId(MENU).click();
  await page.getByTestId(`split-item-${item}`).click();
}

const clipboard = (page: import("@playwright/test").Page) =>
  page.evaluate(() => navigator.clipboard.readText());

test.describe("Ladders share action @sharing", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("the main button copies the self evaluation link", async ({
    data,
    page,
  }) => {
    const member = await seedMember(data, uniqueName("E2E CopySelf"));
    const alerts = watchAlerts(page);

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);
    await page.getByTestId(MAIN).click();

    await expect
      .poll(() => clipboard(page))
      .toBe(`http://localhost:5175/#/e/${member.self_token}`);
    expect(alerts).toContain("Link copied to clipboard!");
  });

  test("the menu copies the peer evaluation link", async ({ data, page }) => {
    const member = await seedMember(data, uniqueName("E2E CopyPeer"));
    watchAlerts(page);

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);
    await copyFromMenu(page, "member_share_peer");

    await expect
      .poll(() => clipboard(page))
      .toBe(`http://localhost:5175/#/e/${member.peer_token}`);
  });

  test("the menu copies the view link and turns it on first", async ({
    data,
    page,
  }) => {
    const member = await seedMember(data, uniqueName("E2E CopyView"));
    // The link exists from the start; sharing it is what the manager decides.
    expect(member.view_enabled).toBe(false);
    watchAlerts(page);

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);
    await copyFromMenu(page, "member_share_view");

    await expect
      .poll(() => clipboard(page))
      .toBe(`http://localhost:5175/#/v/${member.view_token}`);
    // Copying is the moment the decision is made, so it has to be recorded.
    await expect
      .poll(async () => (await data.member(member.id))?.view_enabled)
      .toBe(true);
  });

  test("a manager is offered all three links, even before sharing is on", async ({
    data,
    page,
  }) => {
    const member = await seedMember(data, uniqueName("E2E CopyAllThree"));
    expect(member.view_enabled).toBe(false);

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);
    await page.getByTestId(MENU).click();

    // Every member is issued all three tokens up front, so what is missing here
    // is the decision to share, not the link.
    await expect(
      page.getByTestId("split-item-member_share_self_menu"),
    ).toBeVisible();
    await expect(
      page.getByTestId("split-item-member_share_peer"),
    ).toBeVisible();
    await expect(
      page.getByTestId("split-item-member_share_view"),
    ).toBeVisible();
  });

  test("the evaluated person is offered the peer link but not their own view", async ({
    data,
    page,
  }) => {
    const member = await seedMember(data, uniqueName("E2E CopyAsPerson"));
    await data.setViewEnabled(member.id, true);

    const app = new LaddersApp(page);
    await app.goto(`/#/v/${member.view_token}`);
    await page.getByTestId(MENU).click();

    await expect(
      page.getByTestId("split-item-member_share_self_menu"),
    ).toBeVisible();
    await expect(
      page.getByTestId("split-item-member_share_peer"),
    ).toBeVisible();
    // The view page is reached through that link already, and the token behind it
    // is never handed to the person it belongs to.
    await expect(page.getByTestId("split-item-member_share_view")).toHaveCount(
      0,
    );
  });

  test("a clipboard the browser refuses is reported rather than assumed", async ({
    data,
    page,
  }) => {
    const member = await seedMember(data, uniqueName("E2E CopyDenied"));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("denied")) },
      });
    });
    const alerts = watchAlerts(page);

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);
    await page.getByTestId(MAIN).click();

    await expect.poll(() => alerts).toContain("Failed to copy link");
  });

  test("a browser without the clipboard API falls back to a hidden textarea", async ({
    data,
    page,
  }) => {
    const member = await seedMember(data, uniqueName("E2E CopyFallback"));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
      // The fallback copies whatever is selected inside its own textarea.
      (window as unknown as { copiedFallback?: string }).copiedFallback =
        undefined;
      document.execCommand = (command: string) => {
        if (command === "copy") {
          const active = document.activeElement as HTMLTextAreaElement | null;
          (window as unknown as { copiedFallback?: string }).copiedFallback =
            active?.value ?? "";
          return true;
        }
        return false;
      };
    });
    const alerts = watchAlerts(page);

    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.openTeamMember(member.name);
    await page.getByTestId(MAIN).click();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { copiedFallback?: string }).copiedFallback,
        ),
      )
      .toBe(`http://localhost:5175/#/e/${member.self_token}`);
    expect(alerts).toContain("Link copied to clipboard!");
  });
});
