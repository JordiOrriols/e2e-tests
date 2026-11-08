import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Shiplog reuses application forms for scoped CRUD with persistent audit and nonempty protection", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-shiplog-apps-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    other = randomUUID(),
    team = randomUUID();
  const path = `/api/shiplog/workspaces/${workspace}/applications`;
  await page.setExtraHTTPHeaders(headers);
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await page.route("**/*", async (route) => {
    if (
      !["127.0.0.1", "localhost"].includes(
        new URL(route.request().url()).hostname,
      )
    )
      throw new Error("Unexpected nonlocal browser request");
    await route.continue();
  });
  try {
    localSQL(`BEGIN; INSERT INTO auth.users(id) VALUES('${owner}');
      INSERT INTO public.workspaces(id,owner_id,name) VALUES
      ('${workspace}','${owner}','Local Shiplog CRUD'),('${other}','${owner}','Other Shiplog CRUD');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','Local release team'); COMMIT;`);
    expect((await request.get(path, { headers })).status()).toBe(403);
    localPermission("grant", account.id, "shiplog", workspace, "external");
    expect((await request.get(path, { headers })).status()).toBe(403);
    localPermission("grant", account.id, "shiplog", workspace, "editor");
    await page.goto(`http://127.0.0.1:5320/shiplog/`);
    await page.getByRole("link", { name: "Applications", exact: true }).click();
    await page
      .getByRole("button", { name: "New application", exact: true })
      .click();
    let modal = page.getByRole("dialog");
    await modal
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Local app");
    await modal
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Private app description");
    await modal
      .getByRole("combobox", { name: "Team (optional)", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Local release team", exact: true })
      .click();
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/applications") &&
        response.request().method() === "POST",
    );
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    expect((await created).status()).toBe(201);
    await expect(modal).not.toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Local app", exact: true }),
    ).toBeVisible();
    const directory = await (await request.get(path, { headers })).json();
    const application = directory.applications[0];
    expect(application.team_id).toBe(team);
    await page
      .getByRole("button", { name: "Edit Local app", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Renamed app");
    await modal
      .getByRole("combobox", { name: "Team (optional)", exact: true })
      .click();
    await page.getByRole("option", { name: "No team", exact: true }).click();
    const updated = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/applications/${application.id}`) &&
        response.request().method() === "PATCH",
    );
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    expect((await updated).status()).toBe(200);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Renamed app", exact: true }),
    ).toBeVisible();
    expect(
      (await (await request.get(path, { headers })).json()).applications[0],
    ).toMatchObject({
      id: application.id,
      team_id: null,
      created_at: application.created_at,
    });
    expect(
      (
        await request.patch(`${path}/${application.id}`, {
          headers,
          data: { name: " ", description: "", team_id: null },
        })
      ).status(),
    ).toBe(400);
    localPermission("grant", account.id, "shiplog", other, "editor");
    expect(
      (
        await request.delete(
          `/api/shiplog/workspaces/${other}/applications/${application.id}`,
          { headers },
        )
      ).status(),
    ).toBe(404);
    localSQL(`INSERT INTO public.shiplog_releases(workspace_id,application_id,version,release_type,title)
      VALUES('${workspace}','${application.id}','1.0.0','major','Protected release');`);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Delete Renamed app", exact: true }),
    ).toBeDisabled();
    expect(
      (await request.delete(`${path}/${application.id}`, { headers })).status(),
    ).toBe(409);
    localSQL(
      `DELETE FROM public.shiplog_releases WHERE application_id='${application.id}';`,
    );
    localPermission("grant", account.id, "shiplog", workspace, "viewer");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "New application", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Edit Renamed app", exact: true }),
    ).toHaveCount(0);
    expect(
      (await request.delete(`${path}/${application.id}`, { headers })).status(),
    ).toBe(403);
    localPermission("grant", account.id, "shiplog", workspace, "owner");
    await page.reload();
    await page
      .getByRole("button", { name: "Delete Renamed app", exact: true })
      .click();
    const deleted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/applications/${application.id}`) &&
        response.request().method() === "DELETE",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    expect((await deleted).status()).toBe(200);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Renamed app", exact: true }),
    ).toHaveCount(0);
    expect(
      localSQL(
        `SELECT count(*) FROM platform.shiplog_audit_events WHERE actor_id='${account.id}' AND workspace_id='${workspace}';`,
      ),
    ).toBe("3");
    localPermission("revoke", account.id, "shiplog", workspace);
    expect((await request.get(path, { headers })).status()).toBe(403);
  } finally {
    removeLocalAccount(account.id);
    localSQL(`BEGIN; DELETE FROM public.shiplog_releases WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.shiplog_applications WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.teams WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}');
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
  }
});
