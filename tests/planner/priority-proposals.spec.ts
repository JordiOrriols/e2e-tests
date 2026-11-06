import { expect, test, type Page } from "@playwright/test";
import { authenticatedPage, signIn } from "./planner-helpers";

const token = "11111111-1111-4111-8111-111111111111";
const revision = "a".repeat(32);
const feature = (
  index: number,
  name: string,
  status = "pending",
  dependencies: string[] = [],
) => ({
  id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
  dependency_ids: dependencies,
  name,
  project: "Project",
  status,
  complete: true,
  start: "2026-02-02",
  end: "2026-02-20",
});
const a = feature(4, "Experiment A");
const b = feature(5, "Experiment B", "paused");
const c = feature(6, "Experiment C", "pending", [a.id]);
const official = [
  feature(1, "Earlier pending"),
  feature(2, "Finished", "done"),
  feature(3, "Active", "in_progress"),
  a,
  b,
  c,
];
type Roadmap = {
  revision: string;
  name: string;
  startDate: string;
  markers: [];
  features: typeof official;
};
const forecast = (order = official.map((item) => item.id)): Roadmap => ({
  revision,
  name: "Proposal workspace",
  startDate: "2026-02-02",
  markers: [],
  features: order.map((id, index) => {
    const item = official.find((feature) => feature.id === id);
    if (!item) throw new Error("Unknown test feature");
    const date = new Date("2026-02-02T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + index * 7);
    const start = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 18);
    return { ...item, start, end: date.toISOString().slice(0, 10) };
  }),
});

// Service responses are simulated until deployment is approved. Database and
// real scheduling contracts are covered separately in backend/Planner tests.
async function service(page: Page) {
  const saved: {
    id: string;
    name: string;
    created_at: string;
    roadmap: Roadmap;
  }[] = [];
  const previews: string[][] = [];
  let stale = false;
  let officialWrites = 0;
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  page.on("request", (request) => {
    if (
      /\/rest\/v1\/(features|rpc\/planner_reorder_features)/.test(
        request.url(),
      ) &&
      !["GET", "HEAD"].includes(request.method())
    )
      officialWrites++;
  });
  await page.route("**/functions/v1/roadmap", async (route) => {
    const body = route.request().postDataJSON();
    if (body.proposal) {
      const proposal = saved.find((item) => item.id === body.proposal);
      if (!proposal) throw new Error("Unknown proposal");
      return route.fulfill({ json: proposal.roadmap });
    }
    if (body.featureIds) {
      expect(body.expectedRevision).toBe(revision);
      if (stale)
        return route.fulfill({
          status: 409,
          json: { error: "Roadmap changed" },
        });
      previews.push(body.featureIds);
    }
    return route.fulfill({ json: forecast(body.featureIds) });
  });
  await page.route(
    "**/rest/v1/rpc/planner_list_priority_proposals**",
    (route) =>
      route.fulfill({
        json: saved.map(({ roadmap: _roadmap, ...metadata }) => metadata),
      }),
  );
  await page.route("**/rest/v1/rpc/planner_save_priority_proposal", (route) => {
    const body = route.request().postDataJSON();
    expect(body.expected_revision).toBe(revision);
    const id = `33333333-3333-4333-8333-${String(saved.length + 1).padStart(12, "0")}`;
    saved.push({
      id,
      name: body.proposal_name,
      created_at: "2026-11-06T00:00:00Z",
      roadmap: forecast(body.feature_ids),
    });
    return route.fulfill({ json: id });
  });
  return {
    saved,
    previews,
    makeStale: () => {
      stale = true;
    },
    officialWrites: () => officialWrites,
  };
}
async function open(page: Page) {
  await page.goto(`/#/roadmap/${token}`);
  await expect(
    page.getByRole("heading", { name: "Proposal workspace" }),
  ).toBeVisible();
}

test("only the pending suffix moves; drag recalculates without official writes", async ({
  page,
}) => {
  const state = await service(page);
  await open(page);
  for (const name of ["Earlier pending", "Finished", "Active"])
    await expect(
      page.getByRole("button", { name: `Reorder ${name}` }),
    ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reorder Experiment A" })
    .press("ArrowUp");
  expect(state.previews).toHaveLength(0);
  const before = await page
    .getByRole("img", { name: /^Experiment B:/ })
    .getAttribute("aria-label");
  const row = (name: string) =>
    page
      .getByText(name, { exact: true })
      .locator("xpath=ancestor::div[@draggable='true'][1]");
  await row("Experiment B").dragTo(row("Experiment A"));
  await expect(
    page.getByText(
      "Temporary experiment. The official priorities have not changed.",
    ),
  ).toBeVisible();
  expect(state.previews[0]).toEqual([
    ...official.slice(0, 3).map((item) => item.id),
    b.id,
    a.id,
    c.id,
  ]);
  await expect(
    page.getByRole("img", { name: /^Experiment B:/ }),
  ).not.toHaveAttribute("aria-label", before!);
  await page.getByRole("button", { name: "Return to official plan" }).click();
  await expect(
    page.getByRole("img", { name: /^Experiment B:/ }),
  ).toHaveAttribute("aria-label", before!);
  expect(state.saved).toHaveLength(0);
  expect(state.officialWrites()).toBe(0);
});

test("the drag handle retains keyboard access and dependencies block invalid moves", async ({
  page,
}) => {
  const state = await service(page);
  await open(page);
  const up = page.getByRole("button", { name: "Reorder Experiment C" });
  await up.focus();
  await page.keyboard.press("ArrowUp");
  await expect(
    page.getByText(
      "Temporary experiment. The official priorities have not changed.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reorder Experiment C" })
    .press("ArrowUp");
  await expect(
    page.getByText(
      '"Experiment C" must come after its dependency "Experiment A".',
    ),
  ).toBeVisible();
  expect(state.previews).toHaveLength(1);
  await page.getByRole("button", { name: "Propose priority" }).click();
  await expect(
    page.getByRole("alertdialog").getByRole("heading", { name: "Sign in" }),
  ).toBeVisible();
  expect(state.saved).toHaveLength(0);
  expect(state.officialWrites()).toBe(0);
});

test("signed-in visitors save, recover after reload and compare multiple named snapshots", async ({
  browser,
  baseURL,
}) => {
  const account = await signIn();
  const { page, context } = await authenticatedPage(browser, account, baseURL);
  try {
    const state = await service(page);
    await open(page);
    await page
      .getByRole("button", { name: "Reorder Experiment B" })
      .press("ArrowUp");
    await expect(
      page.getByText(
        "Temporary experiment. The official priorities have not changed.",
      ),
    ).toBeVisible();
    const save = async (name: string) => {
      await page.getByRole("button", { name: "Propose priority" }).click();
      const dialog = page.getByRole("alertdialog");
      await dialog.getByRole("textbox", { name: "Proposal name" }).fill(name);
      await dialog.getByRole("button", { name: "Propose priority" }).click();
      await expect(page.getByText(/Saved snapshot: dates/)).toBeVisible();
    };
    await save("Alternative");
    await page.getByRole("button", { name: "Return to official plan" }).click();
    await save("Baseline");
    expect(state.saved.map((item) => item.name)).toEqual([
      "Alternative",
      "Baseline",
    ]);
    await page.reload();
    await page.getByLabel("View saved proposal", { exact: true }).click();
    await page
      .getByRole("option", { name: "Alternative", exact: true })
      .click();
    await expect(page.getByText(/Saved snapshot: dates/)).toBeVisible();
    await page.getByLabel("Compare with", { exact: true }).click();
    await page.getByRole("option", { name: "Baseline", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Alternative", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Baseline", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: /^Experiment B:/ })).toHaveCount(
      2,
    );
    await page
      .getByRole("button", { name: "Try these priorities on the current plan" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Experiment", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Baseline", exact: true }),
    ).toBeVisible();
    expect(state.saved).toHaveLength(2);
    expect(state.officialWrites()).toBe(0);
  } finally {
    await context.close();
  }
});

test("stale service revisions surface an error and retain the last visible plan", async ({
  page,
}) => {
  const state = await service(page);
  await open(page);
  state.makeStale();
  const before = await page
    .getByRole("img", { name: /^Experiment B:/ })
    .getAttribute("aria-label");
  await page
    .getByRole("button", { name: "Reorder Experiment B" })
    .press("ArrowUp");
  await expect(
    page.getByText(/roadmap has changed or cannot be reordered/i),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /^Experiment B:/ }),
  ).toHaveAttribute("aria-label", before!);
  expect(state.officialWrites()).toBe(0);
});

test("public proposal controls are localized in all six languages on mobile", async ({
  page,
}) => {
  await service(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  for (const [language, title, save] of [
    ["en", "Priority proposals", "Propose priority"],
    ["es", "Propuestas de prioridad", "Proponer prioridad"],
    ["ca", "Propostes de prioritat", "Proposar prioritat"],
    ["fr", "Propositions de priorité", "Proposer une priorité"],
    ["de", "Prioritätsvorschläge", "Priorität vorschlagen"],
    ["it", "Proposte di priorità", "Proponi priorità"],
  ]) {
    await page.getByTestId("language-selector").click();
    await page.getByTestId(`language-button-${language}`).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: save, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByTestId("app-footer")).toBeVisible();
});
