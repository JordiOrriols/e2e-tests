import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Shiplog release forms stage Planner links atomically and preserve frozen version history", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-shiplog-releases-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    other = randomUUID(),
    app = randomUUID(),
    project = randomUUID(),
    otherProject = randomUUID(),
    feature = randomUUID(),
    foreignFeature = randomUUID();
  const path = `/api/shiplog/workspaces/${workspace}/releases`;
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Local release workspace'),('${other}','${owner}','Other release workspace');
      INSERT INTO public.shiplog_applications(id,workspace_id,name) VALUES('${app}','${workspace}','Release app');
      INSERT INTO public.projects(id,workspace_id,name) VALUES('${project}','${workspace}','Release project'),('${otherProject}','${other}','Other release project');
      INSERT INTO public.features(id,project_id,name) VALUES('${feature}','${project}','Included Planner change'),('${foreignFeature}','${otherProject}','Private other feature'); COMMIT;`);
    localPermission("grant", account.id, "shiplog", workspace, "editor");
    localPermission("grant", account.id, "planner", workspace, "viewer");
    await page.goto(
      `http://127.0.0.1:5320/shiplog/workspaces/${workspace}/releases`,
    );
    await page
      .getByRole("button", { name: "New release", exact: true })
      .click();
    let modal = page.getByRole("dialog");
    await modal
      .getByRole("textbox", { name: "Version", exact: true })
      .fill("1.0.0");
    await modal
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Local draft");
    await modal
      .getByRole("textbox", { name: "Public release notes", exact: true })
      .fill("Initial notes");
    await modal
      .getByRole("combobox", { name: "Planner feature", exact: true })
      .click();
    await expect(
      page.getByRole("option", { name: "Private other feature", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("option", { name: "Included Planner change", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "Link feature", exact: true })
      .click();
    expect(
      localSQL(
        `SELECT count(*) FROM public.shiplog_releases WHERE workspace_id='${workspace}';`,
      ),
    ).toBe("0");
    const createdResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/workspaces/${workspace}/releases`) &&
        response.request().method() === "POST",
    );
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    const created = await createdResponse;
    expect(created.status()).toBe(201);
    const release = await created.json();
    expect(release.release_type).toBe("major");
    await expect(modal).not.toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /1\.0\.0\s*Local draft/ }),
    ).toBeVisible();
    await expect(
      page.getByText("Included Planner change", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Release details", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal
      .getByRole("textbox", { name: "Version", exact: true })
      .fill("1.0.1");
    await modal
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("QA release");
    await modal
      .getByRole("button", {
        name: "Unlink Included Planner change",
        exact: true,
      })
      .click();
    await modal
      .getByRole("combobox", { name: "Release status", exact: true })
      .click();
    await page.getByRole("option", { name: "QA", exact: true }).click();
    const updatedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/releases/${release.id}`) &&
        response.request().method() === "PATCH",
    );
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    expect((await updatedResponse).status()).toBe(200);
    await expect(
      modal.getByRole("textbox", { name: "Version", exact: true }),
    ).toBeDisabled();
    await expect(
      modal.getByRole("textbox", { name: "Title", exact: true }),
    ).toBeDisabled();
    await expect(
      modal.getByRole("button", { name: "Link feature", exact: true }),
    ).toHaveCount(0);
    await modal
      .getByRole("textbox", { name: "Public release notes", exact: true })
      .fill("Released notes");
    await modal
      .getByRole("combobox", { name: "Release status", exact: true })
      .click();
    await page.getByRole("option", { name: "Released", exact: true }).click();
    const notesResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/releases/${release.id}`) &&
        response.request().method() === "PATCH",
    );
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    expect((await notesResponse).status()).toBe(200);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /1\.0\.1\s*QA release/ }),
    ).toBeVisible();
    await expect(
      page.getByText("Released notes", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Included Planner change", { exact: true }),
    ).toHaveCount(0);
    const input = {
      application_id: app,
      version: "1.0.1",
      title: "QA release",
      public_notes: "Released notes",
      status: "released",
      feature_ids: null,
    };
    expect(
      (
        await request.patch(`${path}/${release.id}`, {
          headers,
          data: { ...input, title: "Frozen edit" },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await request.patch(`${path}/${release.id}`, {
          headers,
          data: { ...input, feature_ids: [foreignFeature] },
        })
      ).status(),
    ).toBe(409);
    expect((await request.post(path, { headers, data: input })).status()).toBe(
      409,
    );
    expect(
      (
        await request.post(path, {
          headers,
          data: { ...input, version: "01.0.0" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post(path, {
          headers,
          data: { ...input, version: "2.0.0", feature_ids: [foreignFeature] },
        })
      ).status(),
    ).toBe(404);
    const catalog = await (
      await request.get(`/api/shiplog/workspaces/${workspace}/catalog`, {
        headers,
      })
    ).json();
    expect(catalog.releases[0]).toMatchObject({
      id: release.id,
      created_at: release.created_at,
      public_notes: "Released notes",
      status: "released",
      features: [],
    });
    expect(
      localSQL(
        `SELECT count(*) FROM platform.shiplog_audit_events WHERE actor_id='${account.id}' AND workspace_id='${workspace}';`,
      ),
    ).toBe("3");
    localPermission("grant", account.id, "shiplog", workspace, "viewer");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "New release", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Release details", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await expect(
      modal.getByRole("button", { name: "Save", exact: true }),
    ).toHaveCount(0);
    await expect(
      modal.getByRole("textbox", { name: "Public release notes", exact: true }),
    ).toBeDisabled();
    expect(
      (
        await request.patch(`${path}/${release.id}`, { headers, data: input })
      ).status(),
    ).toBe(403);
    localPermission("grant", account.id, "shiplog", workspace, "external");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Release details", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await request.get(`${path}/${release.id}/features`, { headers })
      ).status(),
    ).toBe(403);
  } finally {
    removeLocalAccount(account.id);
    localSQL(`BEGIN; DELETE FROM public.features WHERE project_id IN ('${project}','${otherProject}');
      DELETE FROM public.projects WHERE id IN ('${project}','${otherProject}');
      DELETE FROM public.shiplog_releases WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.shiplog_applications WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}');
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
  }
});
