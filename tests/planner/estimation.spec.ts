import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  addFeatures,
  api,
  authenticatedPage,
  createRoster,
  createWorkspace,
  removeWorkspace,
  selectWorkspace,
  signIn,
  type Account,
} from "./planner-helpers";

const card = (page: Page, feature: string) =>
  page.getByRole("article", { name: feature, exact: true });
const cardsIn = (page: Page, group: string) =>
  page
    .getByRole("region", { name: group, exact: true })
    .getByRole("article")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("aria-label")),
    );

test.describe("Planner feature estimation", () => {
  let owner: Account;
  let context: BrowserContext | undefined;
  let page: Page;
  let workspace: { id: string; name: string };
  const cleanup: (() => Promise<unknown>)[] = [];
  test.beforeEach(async ({ browser }) => {
    owner = await signIn();
    workspace = await createWorkspace(owner);
    cleanup.push(() => removeWorkspace(owner, workspace.id));
    await createRoster(
      owner,
      `Estimation ${randomUUID().slice(0, 8)}`,
      undefined,
      workspace.id,
    );
    const projects = await api<{ id: string; name: string }[]>(
      owner,
      "projects",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(
          ["Payments", "Search"].map((name) => ({
            workspace_id: workspace.id,
            name,
          })),
        ),
      },
    );
    const projectId = (name: string) =>
      projects!.find((project) => project.name === name)!.id;
    // Inserted out of priority order so the page has to sort the Roadmap group itself.
    await addFeatures(owner, workspace.id, [
      {
        name: "Search filters",
        priority: 2,
        backend_devs: 1,
        backend_weeks: 2,
        project_id: projectId("Search"),
      },
      {
        name: "Checkout",
        priority: 1,
        backend_devs: 2,
        backend_weeks: 2,
        frontend_devs: 1,
        frontend_weeks: 3,
        qa_devs: 1,
        qa_weeks: 1,
        project_id: projectId("Payments"),
      },
      {
        name: "Dark mode",
        in_backlog: false,
        frontend_devs: 1,
        frontend_weeks: 1,
      },
    ]);
    ({ context, page } = await authenticatedPage(browser, owner));
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Estimation", exact: true }).click();
  });
  test.afterEach(async () => {
    await context?.close();
    context = undefined;
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  test("features are grouped as Roadmap in priority order, then the unprioritized Backlog", async () => {
    const roadmap = page.getByRole("region", { name: "Roadmap", exact: true });
    const backlog = page.getByRole("region", { name: "Backlog", exact: true });
    await expect(roadmap).toContainText(
      "Prioritized features in roadmap order.",
    );
    await expect(backlog).toContainText("Not prioritized features.");
    await expect
      .poll(() => cardsIn(page, "Roadmap"))
      .toEqual(["Checkout", "Search filters"]);
    await expect.poll(() => cardsIn(page, "Backlog")).toEqual(["Dark mode"]);
    expect((await roadmap.boundingBox())!.y).toBeLessThan(
      (await backlog.boundingBox())!.y,
    );
    // Prioritizing happens on the Roadmap tab only.
    await expect(page.getByRole("button", { name: /roadmap/i })).toHaveCount(0);
    // Cards are full width, one per row.
    const [first, second] = [
      await card(page, "Checkout").boundingBox(),
      await card(page, "Search filters").boundingBox(),
    ];
    expect(first!.x).toBe(second!.x);
    expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
  });

  test("a card shows the main project before the title and folds role details away by default", async () => {
    const checkout = card(page, "Checkout");
    await expect(checkout.getByRole("heading", { level: 3 })).toHaveText(
      "PaymentsCheckout",
    );
    await expect(
      card(page, "Dark mode").getByRole("heading", { level: 3 }),
    ).toHaveText("GeneralDark mode");

    // Backend and frontend overlap (3 people); QA follows for one more week.
    await expect(checkout).toContainText("Peak team3people");
    await expect(checkout).toContainText("Duration6weeks");
    await expect(checkout).toContainText("Effort8person-wks");
    const summary = checkout.getByRole("group", {
      name: "Effort by role",
      exact: true,
    });
    await expect(summary).toHaveText(
      "Backend4person-wksFrontend3person-wksQA1person-wks",
    );

    const toggle = checkout.getByRole("button", {
      name: "Show role details",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      checkout.getByRole("region", { name: "Design", exact: true }),
    ).toBeHidden();
    await toggle.click();
    await expect(
      checkout.getByRole("button", { name: "Hide role details", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(summary).toHaveCount(0);
    for (const [role, values] of [
      ["Backend", "people2weeks2Effort4"],
      ["Frontend", "people1weeks3Effort3"],
      ["Design", "people0weeks0Effort0"],
      ["QA", "people1weeks1Effort1"],
    ]) {
      await expect(
        checkout.getByRole("region", { name: role, exact: true }),
      ).toContainText(values!);
    }
    await checkout
      .getByRole("button", { name: "Hide role details", exact: true })
      .click();
    await expect(summary).toBeVisible();
  });

  test("editing offers Save changes next to Discard, and Discard keeps the saved estimate", async () => {
    await page
      .getByRole("button", { name: "Edit Search filters", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Edit feature" }),
    ).toBeVisible();
    const save = dialog.getByRole("button", {
      name: "Save changes",
      exact: true,
    });
    const discard = dialog.getByRole("button", {
      name: "Discard",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "Close", exact: true }),
    ).toHaveCount(0);
    const [saveBox, discardBox] = [
      await save.boundingBox(),
      await discard.boundingBox(),
    ];
    // Same footer row, Save on the right where Close used to be.
    expect(Math.abs(saveBox!.y - discardBox!.y)).toBeLessThan(2);
    expect(saveBox!.x).toBeGreaterThan(discardBox!.x + discardBox!.width - 1);
    await expect(dialog.getByLabel("Project", { exact: true })).toHaveValue(
      /.+/,
    );

    await dialog.getByLabel("Name", { exact: true }).fill("Discarded name");
    await discard.click();
    await expect(dialog).toBeHidden();
    await expect(card(page, "Search filters")).toBeVisible();

    await page
      .getByRole("button", { name: "Edit Search filters", exact: true })
      .click();
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
      "Search filters",
    );
    await dialog.getByLabel("Name", { exact: true }).fill("Faceted search");
    await dialog
      .getByLabel("Project", { exact: true })
      .selectOption({ label: "Payments" });
    await dialog.getByLabel("Backend weeks", { exact: true }).fill("3");
    await save.click();
    await expect(dialog).toBeHidden();
    await expect(
      card(page, "Faceted search").getByRole("heading", { level: 3 }),
    ).toHaveText("PaymentsFaceted search");
    await expect(card(page, "Faceted search")).toContainText(
      "Effort3person-wks",
    );
    await page.reload();
    await selectWorkspace(page, workspace.name);
    await expect
      .poll(() => cardsIn(page, "Roadmap"))
      .toEqual(["Checkout", "Faceted search"]);
  });

  test("main projects are managed from the estimation page and offered in the feature form", async () => {
    await page
      .getByRole("button", { name: "Manage projects", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("New project name", { exact: true }).fill("Growth");
    await dialog
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Rename Growth", { exact: true }),
    ).toBeVisible();
    // Projects that still hold features cannot be deleted.
    await expect(
      dialog.getByRole("button", { name: "Delete Payments", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Delete Growth", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();

    await page
      .getByRole("button", { name: "New feature", exact: true })
      .click();
    await dialog.getByLabel("Name", { exact: true }).fill("Referrals");
    await dialog
      .getByLabel("Project", { exact: true })
      .selectOption({ label: "Growth" });
    await dialog.getByLabel("Frontend people", { exact: true }).fill("1");
    await dialog.getByLabel("Frontend weeks", { exact: true }).fill("2");
    await dialog
      .getByRole("button", { name: "Create feature", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    // New features land in the Backlog until they are prioritized on the Roadmap tab.
    // Unprioritized features have no defined order.
    await expect
      .poll(async () => (await cardsIn(page, "Backlog")).sort())
      .toEqual(["Dark mode", "Referrals"]);
    await expect(
      card(page, "Referrals").getByRole("heading", { level: 3 }),
    ).toHaveText("GrowthReferrals");
  });
});
