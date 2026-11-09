import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
} from "@playwright/test";
import {
  api,
  authenticatedPage,
  createRoster,
  createWorkspace,
  removeWorkspace,
  signIn,
  selectWorkspace,
} from "./planner-helpers";

type PublicFeature = {
  id: string;
  dependency_ids: string[];
  name: string;
  project: string;
  status: string;
  start: string | null;
  end: string | null;
  complete: boolean;
};
type PublicPlan = {
  name: string;
  revision: string;
  startDate: string;
  markers: unknown[];
  features: PublicFeature[];
};

function measureTitle(title: Locator) {
  return title.evaluate((node) => {
    const cell = node.closest("[draggable]")!;
    return {
      display: getComputedStyle(node).display,
      overflow: getComputedStyle(node).overflow,
      ellipsis: getComputedStyle(node).textOverflow,
      clipped: node.scrollWidth > node.clientWidth,
      withinColumn:
        node.getBoundingClientRect().right <=
        cell.getBoundingClientRect().right + 1,
    };
  });
}

test("real service enforces dependencies and keeps named proposals separate from official priorities", async ({
  browser,
  baseURL,
  page: publicPage,
}) => {
  test.setTimeout(120_000);
  const owner = await signIn();
  const workspace = await createWorkspace(
    owner,
    `Proposals E2E ${randomUUID().slice(0, 8)}`,
  );
  const ids = Array.from({ length: 6 }, () => randomUUID());
  let context: BrowserContext | undefined;
  try {
    await createRoster(
      owner,
      "Proposal roster",
      [
        { name: "Private proposal engineer", planning_role: "backend" },
        { name: "Private proposal designer", planning_role: "design" },
      ],
      workspace.id,
    );
    const projects = await api<{ id: string }[]>(owner, "projects", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(
        ["Core", "Web"].map((name) => ({ workspace_id: workspace.id, name })),
      ),
    });
    if (projects?.length !== 2) throw new Error("Test project creation failed");
    await api(owner, `workspaces?id=eq.${workspace.id}`, {
      method: "PATCH",
      body: JSON.stringify({ plan_start_date: "2026-02-02" }),
    });
    const names = [
      "Earlier pending",
      "Finished",
      "Active",
      "Experiment A",
      "Experiment B",
      "Experiment C",
    ];
    names[0] = "A very long feature title ".repeat(4).trim();
    await api(owner, "features", {
      method: "POST",
      body: JSON.stringify(
        ids.map((id, index) => ({
          id,
          project_id: projects[index > 3 ? 1 : 0]!.id,
          name: names[index],
          description: "Private proposal estimate",
          priority: index + 1,
          in_backlog: true,
          status:
            index === 1
              ? "done"
              : index === 2
                ? "in_progress"
                : index === 4
                  ? "paused"
                  : "pending",
          backend_devs: 1,
          backend_weeks: 1,
          dependency_ids: index === 5 ? [ids[3]] : [],
        })),
      ),
    });
    const token = await api<string>(owner, "rpc/planner_roadmap_share", {
      method: "POST",
      body: JSON.stringify({ workspace: workspace.id, enabled: true }),
    });
    if (!token) throw new Error("Test share token creation failed");
    await expect(
      api(owner, "rpc/planner_roadmap_source", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      api(owner, `features?id=eq.${ids[5]}`, {
        method: "PATCH",
        body: JSON.stringify({ priority: 0 }),
      }),
    ).rejects.toThrow(/must come after/);
    const session = await authenticatedPage(browser, owner, baseURL);
    context = session.context;
    const page = session.page;
    let analyticsEvents = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        /umami|analytics.*\/api\/send/.test(request.url())
      )
        analyticsEvents++;
    });
    const officialResponse = page.waitForResponse((response) =>
      response.url().includes("/functions/v1/roadmap"),
    );
    await page.goto(`/#/roadmap/${token}`);
    const response = await officialResponse;
    expect(response.status()).toBe(200);
    const official: PublicPlan = await response.json();
    expect(official.revision).toMatch(/^[a-f0-9]{32}$/);
    expect(Object.keys(official).sort()).toEqual([
      "features",
      "markers",
      "name",
      "revision",
      "startDate",
    ]);
    for (const item of official.features)
      expect(Object.keys(item).sort()).toEqual([
        "complete",
        "dependency_ids",
        "end",
        "id",
        "name",
        "project",
        "start",
        "status",
      ]);
    expect(JSON.stringify(official)).not.toMatch(
      /Private proposal|backend_devs|backend_weeks|member_id|vacations/,
    );
    await expect(
      page.getByRole("heading", { name: workspace.name, exact: true }),
    ).toBeVisible();
    for (const name of names.slice(0, 3))
      await expect(
        page.getByRole("button", { name: `Reorder ${name}` }),
      ).toHaveCount(0);
    const child = official.features.find((item) => item.id === ids[5])!;
    const prerequisite = official.features.find((item) => item.id === ids[3])!;
    expect(child.start! > prerequisite.end!).toBe(true);
    const previewResponse = page.waitForResponse((response) =>
      response.url().includes("/functions/v1/roadmap"),
    );
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
    await page
      .getByRole("button", { name: "Reorder Experiment B" })
      .dragTo(page.getByRole("button", { name: "Reorder Experiment A" }));
    const preview: PublicPlan = await (await previewResponse).json();
    const order = [ids[0], ids[1], ids[2], ids[4], ids[3], ids[5]];
    expect(preview.features.map((item) => item.id)).toEqual(order);
    expect(preview.features.find((item) => item.id === ids[4])!.start).not.toBe(
      official.features.find((item) => item.id === ids[4])!.start,
    );
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
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    };
    await save("Live alternative");
    const priorities = await api<{ id: string; priority: number }[]>(
      owner,
      `features?project_id=in.(${projects.map((project) => project.id).join(",")})&select=id,priority&order=priority`,
    );
    expect(priorities?.map((item) => item.id)).toEqual(ids);
    await api(owner, `features?id=eq.${ids[3]}`, {
      method: "PATCH",
      body: JSON.stringify({ backend_weeks: 2 }),
    });
    await page.reload();
    await page.getByLabel("View saved proposal", { exact: true }).click();
    await page
      .getByRole("option", { name: "Live alternative", exact: true })
      .click();
    await expect(page.getByText(/Saved snapshot: dates/)).toBeVisible();
    const preserved = page.getByRole("img", { name: /^Experiment A:/ });
    const historicalDates = await preserved.getAttribute("aria-label");
    await page.getByRole("button", { name: "Return to official plan" }).click();
    await save("Live baseline");
    await page.getByLabel("Compare with", { exact: true }).click();
    await page
      .getByRole("option", { name: "Live alternative", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Live baseline", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Live alternative", exact: true }),
    ).toBeVisible();
    const comparison = page.getByRole("region", {
      name: "Live alternative",
      exact: true,
    });
    await expect(
      comparison.getByRole("img", { name: /^Experiment A:/ }),
    ).toHaveAttribute("aria-label", historicalDates!);
    await page
      .getByRole("button", { name: "Try these priorities on the current plan" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Experiment", exact: true }),
    ).toBeVisible();
    const finalPriorities = await api<{ id: string }[]>(
      owner,
      `features?project_id=in.(${projects.map((project) => project.id).join(",")})&select=id&order=priority`,
    );
    expect(finalPriorities?.map((item) => item.id)).toEqual(ids);
    const proposals = await api<{ name: string }[]>(
      owner,
      "rpc/planner_list_priority_proposals",
      {
        method: "POST",
        body: JSON.stringify({ token }),
      },
    );
    expect(proposals?.map((item) => item.name).sort()).toEqual([
      "Live alternative",
      "Live baseline",
    ]);
    await publicPage.addInitScript(() =>
      localStorage.setItem("i18nextLng", "en"),
    );
    const publicListResponse = publicPage.waitForResponse((response) =>
      response.url().includes("/rpc/planner_list_priority_proposals"),
    );
    await publicPage.goto(`/#/roadmap/${token}`);
    const metadata: { id: string; name: string; created_at: string }[] = await (
      await publicListResponse
    ).json();
    expect(metadata).toHaveLength(2);
    for (const item of metadata)
      expect(Object.keys(item).sort()).toEqual(["created_at", "id", "name"]);
    await publicPage.getByLabel("View saved proposal", { exact: true }).click();
    await publicPage
      .getByRole("option", { name: "Live alternative", exact: true })
      .click();
    await expect(publicPage.getByText(/Saved snapshot: dates/)).toBeVisible();
    await expect(
      publicPage.getByRole("img", { name: /^Experiment A:/ }),
    ).toHaveAttribute("aria-label", historicalDates!);
    await publicPage
      .getByRole("button", { name: "Return to official plan" })
      .click();
    const publicTitle = publicPage.getByTitle(names[0]!, { exact: true });
    await expect(publicTitle).toBeVisible();
    const publicWrap = publicPage.getByRole("button", { name: "Wrap titles" });
    if ((await publicWrap.getAttribute("aria-pressed")) === "true")
      await publicWrap.click();
    for (const width of [1280, 390]) {
      await publicPage.setViewportSize({ width, height: 900 });
      expect(await measureTitle(publicTitle)).toEqual({
        display: "block",
        overflow: "hidden",
        ellipsis: "ellipsis",
        clipped: true,
        withinColumn: true,
      });
      await publicWrap.click();
      expect((await measureTitle(publicTitle)).withinColumn).toBe(true);
      await publicWrap.click();
    }
    await publicPage.setViewportSize({ width: 1280, height: 900 });
    await publicPage.getByRole("button", { name: "Propose priority" }).click();
    await expect(
      publicPage
        .getByRole("alertdialog")
        .getByRole("heading", { name: "Sign in" }),
    ).toBeVisible();
    await page.goto("/#/backlog");
    await selectWorkspace(page, workspace.name);
    const title = page.getByTitle(names[0]!, { exact: true });
    const measure = () => measureTitle(title);
    await expect(title).toBeVisible();
    const wrap = page.getByRole("button", { name: "Wrap titles" });
    if ((await wrap.getAttribute("aria-pressed")) === "true")
      await wrap.click();
    for (let width = 0; width < 2; width++) {
      expect(await measure()).toEqual({
        display: "block",
        overflow: "hidden",
        ellipsis: "ellipsis",
        clipped: true,
        withinColumn: true,
      });
      await wrap.click();
      expect((await measure()).withinColumn).toBe(true);
      await wrap.click();
      await page.getByRole("button", { name: "Full width" }).click();
    }
    const marker = await api<{ id: string }[]>(owner, "roadmap_markers", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        workspace_id: workspace.id,
        name: "Rename E2E",
        date: "2026-02-04",
      }),
    });
    if (!marker?.[0]) throw new Error("Test marker creation failed");
    await page.reload();
    await page.getByRole("button", { name: "Manage markers" }).click();
    const manager = page.getByRole("dialog");
    await manager
      .getByRole("button", { name: "Edit marker Rename E2E" })
      .click();
    await manager.getByLabel("Marker name").nth(1).fill("Renamed E2E");
    await manager.getByRole("button", { name: "Save Changes" }).click();
    await expect(
      manager.getByRole("button", { name: "Edit marker Renamed E2E" }),
    ).toBeVisible();
    await manager.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Manage markers" }).click();
    await expect(
      page.getByRole("button", { name: "Edit marker Renamed E2E" }),
    ).toBeVisible();
    expect(
      await api(
        owner,
        `roadmap_markers?id=eq.${marker[0].id}&select=name,date`,
      ),
    ).toEqual([{ name: "Renamed E2E", date: "2026-02-04" }]);
    const renamedPublicPlan = publicPage.waitForResponse((response) =>
      response.url().includes("/functions/v1/roadmap"),
    );
    await publicPage.reload();
    const publicAfterRename: PublicPlan = await (await renamedPublicPlan).json();
    expect(publicAfterRename.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Renamed E2E", date: "2026-02-04" }),
      ]),
    );
    expect(analyticsEvents).toBe(0);
  } finally {
    await context?.close();
    await api(owner, "rpc/planner_roadmap_share", {
      method: "POST",
      body: JSON.stringify({ workspace: workspace.id, enabled: false }),
    });
    await api(owner, `features?id=in.(${ids.join(",")})`, { method: "DELETE" });
    await api(owner, `projects?workspace_id=eq.${workspace.id}`, {
      method: "DELETE",
    });
    await api(owner, `roadmap_markers?workspace_id=eq.${workspace.id}`, {
      method: "DELETE",
    });
    await removeWorkspace(owner, workspace.id);
  }
});
