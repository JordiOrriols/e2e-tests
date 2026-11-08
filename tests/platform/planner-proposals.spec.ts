import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Planner experiments persist snapshots and only editors can confirm official priorities", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-${randomUUID()}`,
  );
  const other = await createLocalAccount(request, `local-e2e-${randomUUID()}`);
  const owner = randomUUID(),
    workspace = randomUUID(),
    project = randomUUID(),
    team = randomUUID();
  const [done, progress, alpha, beta, dependent] = Array.from(
    { length: 5 },
    () => randomUUID(),
  );
  const origin = "http://127.0.0.1:5320";
  const path = `/api/planner/workspaces/${workspace}`;
  const requests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error(`Unexpected nonlocal request: ${url.hostname}`);
    await route.continue();
  });
  await page.setExtraHTTPHeaders(headers);
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  try {
    localSQL(`BEGIN;
      SELECT set_config('request.jwt.claim.sub','${owner}',true);
      INSERT INTO auth.users(id) VALUES('${owner}');
      INSERT INTO public.workspaces(id,owner_id,name,plan_start_date)
        VALUES('${workspace}','${owner}','Local proposal E2E','2026-02-02');
      INSERT INTO public.projects(id,workspace_id,name) VALUES('${project}','${workspace}','Local project');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','Local capacity');
      INSERT INTO public.members(owner_id,team_id,name,planning_role) VALUES('${owner}','${team}','Local developer','backend');
      INSERT INTO public.features(id,project_id,name,in_backlog,priority,status,backend_devs,backend_weeks,dependency_ids) VALUES
        ('${done}','${project}','Completed',true,1,'done',1,1,'{}'),
        ('${progress}','${project}','In progress',true,2,'in_progress',1,1,'{}'),
        ('${alpha}','${project}','Alpha',true,3,'pending',1,1,'{}'),
        ('${beta}','${project}','Beta',true,4,'pending',1,1,'{}'),
        ('${dependent}','${project}','Depends on Alpha',true,5,'pending',1,1,ARRAY['${alpha}']::uuid[]);
      COMMIT;`);
    expect((await request.get(`${path}/proposals`, { headers })).status()).toBe(
      403,
    );
    expect((await request.post(`${path}/preview`, { data: {} })).status()).toBe(
      401,
    );
    localPermission("grant", account.id, "planner", workspace, "external");
    const officialResponse = await request.get(`${path}/roadmap`, { headers });
    expect(officialResponse.status()).toBe(200);
    const official = await officialResponse.json();
    const applyLabel = "Apply priorities to official plan";
    expect(
      (
        await request.post(`${path}/priorities`, {
          data: {
            featureIds: [done, progress, beta, alpha, dependent],
            expectedRevision: official.revision,
          },
        })
      ).status(),
    ).toBe(401);
    const priorityBefore =
      localSQL(`SELECT json_agg(json_build_object('id',id,'priority',priority) ORDER BY priority)
      FROM public.features WHERE project_id='${project}'`);
    await page.goto(`${origin}/planner/workspaces/${workspace}/roadmap`);
    await expect(
      page.getByRole("heading", { name: "Local proposal E2E", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reorder Completed", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Reorder In progress", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Reorder/ })).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: applyLabel, exact: true }),
    ).toHaveCount(0);
    const label = (name: string) =>
      page
        .locator('[draggable="true"]')
        .filter({ has: page.getByTitle(name, { exact: true }) });
    const previewResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`${path}/preview`) &&
        response.request().method() === "POST",
    );
    await label("Beta").dragTo(label("Alpha"));
    const preview = await (await previewResponse).json();
    expect(
      preview.features.map((feature: { id: string }) => feature.id),
    ).toEqual([done, progress, beta, alpha, dependent]);
    expect(
      preview.features.find((feature: { id: string }) => feature.id === alpha)
        .start,
    ).not.toEqual(
      official.features.find((feature: { id: string }) => feature.id === alpha)
        .start,
    );
    await expect(page.getByRole("status")).toContainText(
      "Temporary experiment",
    );
    expect(
      await (await request.get(`${path}/proposals`, { headers })).json(),
    ).toEqual([]);
    expect(
      localSQL(`SELECT json_agg(json_build_object('id',id,'priority',priority) ORDER BY priority)
      FROM public.features WHERE project_id='${project}'`),
    ).toBe(priorityBefore);
    await page
      .getByRole("button", { name: "Propose priority", exact: true })
      .click();
    const dialog = page.getByRole("alertdialog");
    await dialog
      .getByRole("textbox", { name: "Proposal name", exact: true })
      .fill("Alternative A");
    await dialog
      .getByRole("button", { name: "Propose priority", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Alternative A", exact: true }),
    ).toBeVisible();
    const proposals = await (
      await request.get(`${path}/proposals`, { headers })
    ).json();
    expect(proposals).toHaveLength(1);
    const saved = await (
      await request.get(`${path}/proposals/${proposals[0].id}`, { headers })
    ).json();
    expect(saved).toEqual(preview);
    expect(
      (
        await request.post(`${path}/priorities`, {
          headers,
          data: {
            featureIds: [done, progress, beta, alpha, dependent],
            expectedRevision: official.revision,
          },
        })
      ).status(),
    ).toBe(403);
    expect(Object.keys(saved).sort()).toEqual([
      "features",
      "markers",
      "name",
      "revision",
      "startDate",
    ]);
    expect(
      (
        await request.get(`${path}/proposals/${proposals[0].id}`, {
          headers: other.headers,
        })
      ).status(),
    ).toBe(403);
    localPermission(
      "grant",
      other.account.id,
      "shiplog",
      workspace,
      "external",
    );
    expect(
      (
        await request.get(`${path}/proposals`, { headers: other.headers })
      ).status(),
    ).toBe(403);
    localPermission("grant", other.account.id, "planner", workspace, "viewer");
    expect(
      (
        await request.post(`${path}/priorities`, {
          headers: other.headers,
          data: {
            featureIds: [done, progress, beta, alpha, dependent],
            expectedRevision: official.revision,
          },
        })
      ).status(),
    ).toBe(403);
    expect(
      await (
        await request.get(`${path}/proposals/${proposals[0].id}`, {
          headers: other.headers,
        })
      ).json(),
    ).toEqual(saved);
    await page.reload();
    await page
      .getByRole("combobox", { name: "View saved proposal", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Alternative A", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Alternative A", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Compare with", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Official plan", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Official plan", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Reorder/ })).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "Try these priorities on the current plan",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Temporary experiment",
    );
    await page
      .getByRole("combobox", { name: "Compare with", exact: true })
      .click();
    await page
      .getByRole("option", { name: "No comparison", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Propose priority", exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "Proposal name", exact: true })
      .fill("Alternative B");
    await dialog
      .getByRole("button", { name: "Propose priority", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Alternative B", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Compare with", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Alternative A", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Alternative A", exact: true }),
    ).toBeVisible();
    expect(
      await (await request.get(`${path}/proposals`, { headers })).json(),
    ).toHaveLength(2);
    expect(
      localSQL(`SELECT json_agg(json_build_object('id',id,'priority',priority) ORDER BY priority)
      FROM public.features WHERE project_id='${project}'`),
    ).toBe(priorityBefore);
    const invalid = await request.post(`${path}/preview`, {
      headers,
      data: {
        featureIds: [done, progress, dependent, alpha, beta],
        expectedRevision: official.revision,
      },
    });
    expect(invalid.status()).toBe(409);
    expect((await invalid.json()).message).toContain("dependency");
    const locked = await request.post(`${path}/preview`, {
      headers,
      data: {
        featureIds: [progress, done, alpha, beta, dependent],
        expectedRevision: official.revision,
      },
    });
    expect(locked.status()).toBe(409);
    expect(
      (
        await request.post(`${path}/proposals`, {
          headers,
          data: { name: "Invalid", featureIds: [], expectedRevision: "stale" },
        })
      ).status(),
    ).toBe(400);
    localSQL(
      `UPDATE public.features SET name='Alpha changed' WHERE id='${alpha}'`,
    );
    const stale = await request.post(`${path}/proposals`, {
      headers,
      data: {
        name: "Stale",
        featureIds: [done, progress, beta, alpha, dependent],
        expectedRevision: official.revision,
      },
    });
    expect(stale.status()).toBe(409);
    expect(
      await (
        await request.get(`${path}/proposals/${proposals[0].id}`, { headers })
      ).json(),
    ).toEqual(saved);
    localPermission("grant", account.id, "planner", workspace, "editor");
    await page.reload();
    await expect(
      page.getByRole("button", { name: applyLabel, exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("combobox", { name: "View saved proposal", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Alternative A", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Alternative A", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: applyLabel, exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", {
        name: "Try these priorities on the current plan",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Temporary experiment",
    );
    await page.getByRole("button", { name: applyLabel, exact: true }).click();
    await expect(dialog).toContainText("saved proposals remain unchanged");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      localSQL(`SELECT json_agg(json_build_object('id',id,'priority',priority) ORDER BY priority)
      FROM public.features WHERE project_id='${project}'`),
    ).toBe(priorityBefore);
    await page.getByRole("button", { name: applyLabel, exact: true }).click();
    const appliedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`${path}/priorities`) &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: applyLabel, exact: true }).click();
    const appliedHTTP = await appliedResponse;
    expect(appliedHTTP.status()).toBe(201);
    const applied = await appliedHTTP.json();
    expect(Object.keys(applied).sort()).toEqual([
      "features",
      "markers",
      "name",
      "revision",
      "startDate",
    ]);
    expect(
      applied.features.map((feature: { id: string }) => feature.id),
    ).toEqual([done, progress, beta, alpha, dependent]);
    expect(applied.revision).not.toBe(official.revision);
    await expect(
      page.getByRole("heading", { name: "Official plan", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: applyLabel, exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        "Temporary experiment. The official priorities have not changed.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await page.reload();
    expect(
      await (
        await request.get(`${path}/roadmap`, { headers: other.headers })
      ).json(),
    ).toEqual(applied);
    expect(
      await (
        await request.get(`${path}/proposals/${proposals[0].id}`, { headers })
      ).json(),
    ).toEqual(saved);
    expect(
      JSON.parse(
        localSQL(
          `SELECT json_agg(id ORDER BY priority) FROM public.features WHERE project_id='${project}'`,
        ),
      ),
    ).toEqual([done, progress, beta, alpha, dependent]);
    expect(
      (
        await request.post(`${path}/priorities`, {
          headers,
          data: {
            featureIds: [done, progress, alpha, beta, dependent],
            expectedRevision: official.revision,
          },
        })
      ).status(),
    ).toBe(409);
    localPermission("revoke", account.id, "planner", workspace);
    for (const suffix of ["/proposals", `/proposals/${proposals[0].id}`])
      expect(
        (await request.get(`${path}${suffix}`, { headers })).status(),
      ).toBe(403);
    expect(
      (
        await request.post(`${path}/priorities`, {
          headers,
          data: {
            featureIds: [done, progress, alpha, beta, dependent],
            expectedRevision: applied.revision,
          },
        })
      ).status(),
    ).toBe(403);
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
    removeLocalAccount(other.account.id);
    removeLocalAccount(account.id);
    localSQL(`BEGIN;
      DELETE FROM public.features WHERE project_id='${project}';
      DELETE FROM public.projects WHERE id='${project}';
      DELETE FROM public.members WHERE team_id='${team}';
      DELETE FROM public.teams WHERE id='${team}';
      DELETE FROM public.workspaces WHERE id='${workspace}';
      DELETE FROM auth.users WHERE id='${owner}';
      COMMIT;`);
  }
});
