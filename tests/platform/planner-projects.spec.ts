import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Planner project modal uses scoped API CRUD and protects projects with backlog features", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID();
  const path = `/api/planner/workspaces/${workspace}/projects`;
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
      VALUES('${workspace}','${owner}','Local project E2E','2026-02-02'); COMMIT;`);
    for (const role of ["external", "viewer"]) {
      localPermission("grant", account.id, "planner", workspace, role);
      await page.goto(
        `http://127.0.0.1:5320/planner/workspaces/${workspace}/roadmap`,
      );
      await expect(
        page.getByRole("heading", { name: "Local project E2E", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Manage projects", exact: true }),
      ).toHaveCount(0);
      expect(
        (
          await request.post(path, { headers, data: { name: "Denied" } })
        ).status(),
      ).toBe(403);
    }
    localPermission("grant", account.id, "planner", workspace, "editor");
    await page.reload();
    await page
      .getByRole("button", { name: "Manage projects", exact: true })
      .click();
    const manager = page.getByRole("dialog");
    await manager
      .getByRole("textbox", { name: "New project name", exact: true })
      .fill("Project");
    await manager
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await expect(
      manager.getByRole("textbox", { name: "Rename Project", exact: true }),
    ).toBeVisible();
    const created = await (await request.get(path, { headers })).json();
    expect(created).toHaveLength(1);
    await manager
      .getByRole("textbox", { name: "Rename Project", exact: true })
      .fill("Renamed");
    await manager
      .getByRole("button", { name: "Save Project", exact: true })
      .click();
    await expect(
      manager.getByRole("textbox", { name: "Rename Renamed", exact: true }),
    ).toBeVisible();
    const renamed = await (await request.get(path, { headers })).json();
    expect(renamed).toEqual([{ ...created[0], name: "Renamed" }]);
    expect(
      (
        await request.patch(`${path}/${created[0].id}`, {
          headers,
          data: { name: "" },
        })
      ).status(),
    ).toBe(400);
    localSQL(
      `INSERT INTO public.features(project_id,name) VALUES('${created[0].id}','Backlog task')`,
    );
    expect(
      (await request.delete(`${path}/${created[0].id}`, { headers })).status(),
    ).toBe(409);
    await page.reload();
    await page
      .getByRole("button", { name: "Manage projects", exact: true })
      .click();
    await expect(
      manager.getByRole("button", { name: "Delete Renamed", exact: true }),
    ).toBeDisabled();
    localSQL(`DELETE FROM public.features WHERE project_id='${created[0].id}'`);
    await page.reload();
    await page
      .getByRole("button", { name: "Manage projects", exact: true })
      .click();
    await manager
      .getByRole("button", { name: "Delete Renamed", exact: true })
      .click();
    await expect(
      manager.getByText("No projects yet.", { exact: true }),
    ).toBeVisible();
    expect(await (await request.get(path, { headers })).json()).toEqual([]);
    expect(
      (await request.delete(`${path}/${created[0].id}`, { headers })).status(),
    ).toBe(404);
    localPermission("revoke", account.id, "planner", workspace);
    expect((await request.get(path, { headers })).status()).toBe(403);
    expect(
      (
        await request.post(path, { headers, data: { name: "Denied" } })
      ).status(),
    ).toBe(403);
  } finally {
    removeLocalAccount(account.id);
    localSQL(`BEGIN;
      DELETE FROM public.features WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id='${workspace}');
      DELETE FROM public.projects WHERE workspace_id='${workspace}';
      DELETE FROM public.workspaces WHERE id='${workspace}'; DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
  }
});
