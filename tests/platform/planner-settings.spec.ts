import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Planner adds prerequisites before dependants and saves verified start dates through the API", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    project = randomUUID();
  const first = randomUUID(),
    second = randomUUID();
  const path = `/api/planner/workspaces/${workspace}`;
  await page.setExtraHTTPHeaders(headers);
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error(`Unexpected nonlocal request: ${url.hostname}`);
    await route.continue();
  });
  try {
    localSQL(`BEGIN; INSERT INTO auth.users(id) VALUES('${owner}');
      INSERT INTO public.workspaces(id,owner_id,name,plan_start_date)
      VALUES('${workspace}','${owner}','Local settings E2E','2026-02-02');
      INSERT INTO public.projects(id,workspace_id,name) VALUES('${project}','${workspace}','Settings project');
      INSERT INTO public.features(id,project_id,name,dependency_ids) VALUES
      ('${first}','${project}','Prerequisite','{}'),
      ('${second}','${project}','Dependant',ARRAY['${first}']::uuid[]); COMMIT;`);
    localPermission("grant", account.id, "planner", workspace, "editor");
    await page.goto(
      `http://127.0.0.1:5320/planner/workspaces/${workspace}/estimation`,
    );
    await page
      .getByRole("button", { name: "Add feature", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await modal
      .getByRole("button", {
        name: "Add feature to roadmap: Dependant",
        exact: true,
      })
      .click();
    await expect(modal.getByRole("alert")).toContainText("must come after");
    const official = page.getByRole("region", {
      name: "Official plan",
      exact: true,
    });
    expect(
      (await (await request.get(`${path}/roadmap`, { headers })).json())
        .features,
    ).toEqual([]);
    await modal
      .getByRole("button", {
        name: "Add feature to roadmap: Prerequisite",
        exact: true,
      })
      .click();
    await expect(
      modal.getByRole("button", {
        name: "Add feature to roadmap: Prerequisite",
        exact: true,
      }),
    ).toHaveCount(0);
    await modal
      .getByRole("button", {
        name: "Add feature to roadmap: Dependant",
        exact: true,
      })
      .click();
    await expect(
      modal.getByText("All features are already on the roadmap.", {
        exact: true,
      }),
    ).toBeVisible();
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    const source = await (
      await request.get(`${path}/roadmap`, { headers })
    ).json();
    expect(
      source.features.map((feature: { id: string }) => feature.id),
    ).toEqual([first, second]);
    await expect(official).toHaveCount(0);
    const before = await (
      await request.get(`${path}/features`, { headers })
    ).json();
    await request.post(`${path}/proposals`, {
      headers,
      data: {
        name: "Preserved settings snapshot",
        featureIds: [first, second],
        expectedRevision: source.revision,
      },
    });
    const row = page.getByRole("article", {
      name: "Prerequisite",
      exact: true,
    });
    await row
      .getByRole("button", { name: "Remove from roadmap", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("must come after");
    await page.getByRole("link", { name: "Roadmap", exact: true }).click();
    await expect(
      official.getByRole("button", {
        name: "Reorder Prerequisite",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Feature estimation", exact: true }),
    ).toHaveCount(0);
    const date = page.getByRole("textbox", {
      name: "Plan starts",
      exact: true,
    });
    const [saved] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`${path}/start-date`) &&
          response.request().method() === "PATCH",
      ),
      date.fill("2026-03-02"),
    ]);
    expect(saved.status()).toBe(200);
    await expect(date).toHaveValue("2026-03-02");
    expect(
      await (await request.get(`${path}/features`, { headers })).json(),
    ).toEqual(before);
    expect(
      (
        await request.patch(`${path}/start-date`, {
          headers,
          data: { date: "2028-03-02" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.patch(`${path}/start-date`, {
          headers,
          data: { date: "2026-02-30" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.patch(`${path}/features/${first}/inclusion`, {
          headers,
          data: { included: "false" },
        })
      ).status(),
    ).toBe(400);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Plan starts", exact: true }),
    ).toHaveValue("2026-03-02");
    localPermission("grant", account.id, "planner", workspace, "viewer");
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Plan starts", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Estimation", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Feature estimation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add feature", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Plan starts", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await request.patch(`${path}/features/${second}/inclusion`, {
          headers,
          data: { included: false },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.patch(`${path}/start-date`, {
          headers,
          data: { date: "2026-04-02" },
        })
      ).status(),
    ).toBe(403);
    localPermission("grant", account.id, "planner", workspace, "owner");
    await page.reload();
    for (const id of [second, first])
      expect(
        (
          await request.patch(`${path}/features/${id}/inclusion`, {
            headers,
            data: { included: false },
          })
        ).status(),
      ).toBe(200);
    expect(
      (await (await request.get(`${path}/roadmap`, { headers })).json())
        .features,
    ).toEqual([]);
    localPermission("revoke", account.id, "planner", workspace);
    expect(
      (
        await request.patch(`${path}/start-date`, {
          headers,
          data: { date: "2026-04-02" },
        })
      ).status(),
    ).toBe(403);
  } finally {
    removeLocalAccount(account.id);
    localSQL(`BEGIN; DELETE FROM public.features WHERE project_id='${project}';
      DELETE FROM public.projects WHERE id='${project}'; DELETE FROM public.workspaces WHERE id='${workspace}';
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
  }
});
