import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Planner reuses task forms for private estimates and dependencies with internal API grants", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID();
  const path = `/api/planner/workspaces/${workspace}/features`;
  const pageURL = `http://127.0.0.1:5320/planner/workspaces/${workspace}/roadmap`;
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
      VALUES('${workspace}','${owner}','Local task E2E','2026-02-02'); COMMIT;`);
    localPermission("grant", account.id, "planner", workspace, "editor");
    await page.goto(pageURL);
    await page
      .getByRole("button", { name: "New feature", exact: true })
      .click();
    let form = page.getByRole("dialog");
    await form
      .getByRole("textbox", { name: "New project name", exact: true })
      .fill("API project");
    await form
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("First task");
    await form
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Private task details");
    await form
      .getByRole("spinbutton", { name: "Backend people", exact: true })
      .fill("1");
    await form
      .getByRole("spinbutton", { name: "Backend weeks", exact: true })
      .fill("2");
    await form
      .getByRole("button", { name: "Create feature", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: "First task", exact: true }),
    ).toBeVisible();
    let tasks = await (await request.get(path, { headers })).json();
    expect(tasks).toHaveLength(1);
    const first = tasks[0];
    expect(first).toMatchObject({
      name: "First task",
      description: "Private task details",
      backend_devs: 1,
      backend_weeks: 2,
      in_backlog: false,
      priority: 0,
    });
    await page
      .getByRole("button", { name: "New feature", exact: true })
      .click();
    form = page.getByRole("dialog");
    await form.getByRole("combobox", { name: "Project", exact: true }).click();
    await page
      .getByRole("option", { name: "API project", exact: true })
      .click();
    await form
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Second task");
    await form.getByRole("checkbox", { name: /First task/ }).check();
    await form
      .getByRole("button", { name: "Create feature", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: "Second task", exact: true }),
    ).toBeVisible();
    tasks = await (await request.get(path, { headers })).json();
    const second = tasks.find(
      (task: { name: string }) => task.name === "Second task",
    );
    expect(second.dependency_ids).toEqual([first.id]);
    await page
      .getByRole("button", { name: "Edit First task", exact: true })
      .click();
    form = page.getByRole("dialog");
    await form.getByRole("checkbox", { name: /Second task/ }).check();
    await form
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText("cycle");
    expect(
      (await (await request.get(path, { headers })).json()).find(
        (task: { id: string }) => task.id === first.id,
      ).dependency_ids,
    ).toEqual([]);
    await form.getByRole("checkbox", { name: /Second task/ }).uncheck();
    await form
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Renamed task");
    await form
      .getByRole("spinbutton", { name: "Backend weeks", exact: true })
      .fill("3");
    await form.getByRole("combobox", { name: "Status", exact: true }).click();
    await page
      .getByRole("option", { name: "In progress", exact: true })
      .click();
    await form
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: "Renamed task", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("article", { name: "Renamed task", exact: true }),
    ).toContainText("Private task details");
    const renamed = (await (await request.get(path, { headers })).json()).find(
      (task: { id: string }) => task.id === first.id,
    );
    expect(renamed).toEqual({
      ...first,
      name: "Renamed task",
      backend_weeks: 3,
      status: "in_progress",
    });
    expect(
      (
        await request.patch(`${path}/${first.id}`, {
          headers,
          data: { ...renamed, backend_devs: 1.5 },
        })
      ).status(),
    ).toBe(400);
    await page
      .getByRole("button", { name: "Delete Renamed task", exact: true })
      .click();
    let confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("article", { name: "Renamed task", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Delete Renamed task", exact: true })
      .click();
    confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid dependencies");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    localPermission("grant", account.id, "planner", workspace, "viewer");
    await page.reload();
    await expect(
      page.getByRole("article", { name: "Renamed task", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New feature", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Edit Renamed task", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await request.patch(`${path}/${first.id}`, { headers, data: renamed })
      ).status(),
    ).toBe(403);
    expect(
      (await request.delete(`${path}/${first.id}`, { headers })).status(),
    ).toBe(403);
    localPermission("grant", account.id, "planner", workspace, "external");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Local task E2E", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Private task details", { exact: true }),
    ).toHaveCount(0);
    expect((await request.get(path, { headers })).status()).toBe(403);
    localPermission("grant", account.id, "planner", workspace, "owner");
    await page.reload();
    for (const name of ["Second task", "Renamed task"]) {
      const id = name === "Second task" ? second.id : first.id;
      await page
        .getByRole("button", { name: `Delete ${name}`, exact: true })
        .click();
      const [deleted] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().endsWith(`${path}/${id}`) &&
            response.request().method() === "DELETE",
        ),
        page
          .getByRole("alertdialog")
          .getByRole("button", { name: "Delete", exact: true })
          .click(),
      ]);
      expect(deleted.status()).toBe(200);
      await expect(
        page.getByRole("article", { name, exact: true }),
      ).toHaveCount(0);
    }
    expect(await (await request.get(path, { headers })).json()).toEqual([]);
    expect(
      (await request.delete(`${path}/${first.id}`, { headers })).status(),
    ).toBe(404);
    localPermission("revoke", account.id, "planner", workspace);
    expect((await request.get(path, { headers })).status()).toBe(403);
  } finally {
    removeLocalAccount(account.id);
    localSQL(`BEGIN;
      DELETE FROM public.features WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id='${workspace}');
      DELETE FROM public.projects WHERE workspace_id='${workspace}';
      DELETE FROM public.workspaces WHERE id='${workspace}'; DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
  }
});
