import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  api,
  createWorkspace,
  openPulse,
  PULSE_URL,
  removeWorkspace,
  selectWorkspace,
  signIn,
} from "./pulse-helpers";

test("active retro links open the exact fullscreen room without bypassing sign-in", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const owner = await signIn();
  const workspace = await createWorkspace(
    owner,
    `Fullscreen ${randomUUID().slice(0, 8)}`,
  );
  const other = await createWorkspace(
    owner,
    `Other ${randomUUID().slice(0, 8)}`,
  );
  const contexts: BrowserContext[] = [];
  try {
    const retro = await api<string>(owner, "rpc/create_pulse_retro", {
      method: "POST",
      body: JSON.stringify({
        workspace: workspace.id,
        retro_title: "Fullscreen review",
        held: "2026-10-19",
        retro_period: "",
        retro_goal: "",
        retro_template: "open",
        is_anonymous: true,
        votes: 3,
      }),
    });
    if (!retro) throw new Error("Retro creation returned no ID");
    await api(owner, "rpc/set_pulse_retro_stage", {
      method: "POST",
      body: JSON.stringify({ retro, new_stage: "collect" }),
    });
    const opened = await openPulse(browser, owner);
    contexts.push(opened.context);
    const page = opened.page;
    await opened.context.grantPermissions(
      ["clipboard-read", "clipboard-write"],
      { origin: PULSE_URL },
    );
    await selectWorkspace(page, workspace.name);
    await page
      .getByRole("navigation", { name: "Pulse pages" })
      .getByRole("link", { name: "Retrospectives" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Fullscreen review" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Share fullscreen link" }).click();
    await expect(
      page.getByRole("button", { name: "Link copied" }),
    ).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(link).hash).toBe(
      `#/workspaces/${workspace.id}/retrospectives/${retro}`,
    );
    await page
      .getByRole("link", { name: "Open fullscreen", exact: true })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Pulse pages" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Fullscreen review" }),
    ).toBeVisible();
    await page.getByLabel("New topic in Topics").fill("Keep the focus");
    await page
      .getByRole("region", { name: "Topics", exact: true })
      .getByRole("button", { name: "Add", exact: true })
      .click();
    await expect(
      page.getByText("Keep the focus", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(2);
    await page.screenshot({
      path: test.info().outputPath("fullscreen-retro-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page
      .getByRole("button", { name: "Enter browser fullscreen" })
      .click();
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(true);
    await page.getByRole("button", { name: "Exit browser fullscreen" }).click();
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(false);
    await page.getByRole("button", { name: "Back to retrospectives" }).click();
    await selectWorkspace(page, other.name);
    await page.goto(link);
    await expect(
      page.getByRole("heading", { name: "Fullscreen review" }),
    ).toBeVisible();
    await expect(
      page.getByText("Keep the focus", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Fullscreen review" }),
    ).toBeVisible();

    const visitor = await openPulse(browser);
    contexts.push(visitor.context);
    await visitor.page.goto(link);
    await expect(
      visitor.page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(
      visitor.page.getByText("Keep the focus", { exact: true }),
    ).toHaveCount(0);

    await page.goto(
      `${PULSE_URL}/#/workspaces/${randomUUID()}/retrospectives/${retro}`,
    );
    await expect(page.getByRole("alert")).toContainText("do not have access");
    await expect(
      page.getByRole("heading", { name: "Fullscreen review" }),
    ).toHaveCount(0);
    await page.goto(
      `${PULSE_URL}/#/workspaces/${workspace.id}/retrospectives/${randomUUID()}`,
    );
    await expect(
      page.getByText("Retrospective unavailable", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Fullscreen review" }),
    ).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
    await removeWorkspace(owner, other.id);
    await removeWorkspace(owner, workspace.id);
  }
});
