import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Planner uses one-origin path routing, server scheduling and explicit external grants", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-${randomUUID()}`,
  );
  const source: { id: string; name: string } = JSON.parse(
    localSQL(
      "SELECT json_build_object('id',w.id,'name',w.name) FROM public.workspaces w JOIN public.projects p ON p.workspace_id=w.id JOIN public.features f ON f.project_id=p.id WHERE f.in_backlog LIMIT 1",
    ),
  );
  expect(source.id).toMatch(/^[0-9a-f-]{36}$/);
  const origin = "http://127.0.0.1:5320";
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await page.setExtraHTTPHeaders(headers);
  const requests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error(`Unexpected nonlocal browser request: ${url.hostname}`);
    await route.continue();
  });
  try {
    await page.goto(`${origin}/planner/`);
    await expect(page.getByRole("status")).toContainText("do not have access");
    expect(
      (
        await request.get(`/api/planner/workspaces/${source.id}/roadmap`, {
          headers,
        })
      ).status(),
    ).toBe(403);
    localPermission("grant", account.id, "planner", source.id, "external");
    await page.reload();
    await page.getByRole("link", { name: source.name, exact: true }).click();
    await expect(page).toHaveURL(
      `${origin}/planner/workspaces/${source.id}/roadmap`,
    );
    await expect(
      page.getByRole("heading", { name: source.name, exact: true }),
    ).toBeVisible();
    const response = await request.get(
      `/api/planner/workspaces/${source.id}/roadmap`,
      { headers },
    );
    expect(response.status()).toBe(200);
    const roadmap = await response.json();
    expect(Object.keys(roadmap).sort()).toEqual([
      "features",
      "markers",
      "name",
      "revision",
      "startDate",
    ]);
    expect(roadmap.features.length).toBeGreaterThan(0);
    for (const feature of roadmap.features) {
      expect(Object.keys(feature).sort()).toEqual([
        "complete",
        "dependency_ids",
        "end",
        "id",
        "name",
        "project",
        "start",
        "status",
      ]);
      await expect(
        page.getByTitle(feature.name, { exact: true }).first(),
      ).toBeVisible();
    }
    const lastLocked = roadmap.features.reduce(
      (last: number, feature: { status: string }, index: number) =>
        ["done", "in_progress"].includes(feature.status) ? index : last,
      -1,
    );
    await expect(page.getByRole("button", { name: /^Reorder/ })).toHaveCount(
      roadmap.features.length - lastLocked - 1,
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: source.name, exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
    await page.setViewportSize({ width: 390, height: 844 });
    const titles = page
      .locator("[title]")
      .filter({ hasText: roadmap.features[0].name });
    await expect(titles.first()).toBeVisible();
    for (const feature of roadmap.features) {
      const title = page.getByTitle(feature.name, { exact: true }).first();
      expect(
        await title.evaluate((node) => {
          const column = node.closest("[draggable]");
          if (!column) throw new Error("Timeline label column not found");
          return {
            withinColumn:
              node.getBoundingClientRect().right <=
              column.getBoundingClientRect().right + 1,
            ellipsis: getComputedStyle(node).textOverflow,
            display: getComputedStyle(node).display,
          };
        }),
      ).toEqual({ withinColumn: true, ellipsis: "ellipsis", display: "block" });
    }
    await page.goto(`${origin}/shiplog/`);
    await expect(page.getByRole("status")).toContainText("do not have access");
    await page.goto(`${origin}/planner/workspaces/${source.id}/roadmap`);
    localPermission("revoke", account.id, "planner", source.id);
    await page.reload();
    await expect(page.getByRole("alert")).toContainText(
      "Workspace access required",
    );
    expect(
      requests.some(
        (url) => url.includes("supabase") || url.includes("/auth/"),
      ),
    ).toBe(false);
  } finally {
    removeLocalAccount(account.id);
  }
});
