import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Shiplog reuses template and QA views with immutable snapshots and scoped platform completion", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-shiplog-checklists-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    other = randomUUID(),
    app = randomUUID(),
    foreignApp = randomUUID();
  const base = `/api/shiplog/workspaces/${workspace}`;
  const templatePath = `${base}/applications/${app}/checklist-template`;
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Checklist workspace'),('${other}','${owner}','Other checklist workspace');
      INSERT INTO public.shiplog_applications(id,workspace_id,name) VALUES('${app}','${workspace}','Checklist app'),('${foreignApp}','${other}','Foreign checklist app'); COMMIT;`);
    localPermission("grant", account.id, "shiplog", workspace, "owner");
    const releaseInput = {
      application_id: app,
      version: "1.0.0",
      title: "Checklist release",
      public_notes: "",
      status: "released",
      feature_ids: null,
    };
    const emptyResponse = await request.post(`${base}/releases`, {
      headers,
      data: releaseInput,
    });
    expect(emptyResponse.status()).toBe(201);
    const empty = await emptyResponse.json();
    await page.goto(
      `http://127.0.0.1:5320/shiplog/workspaces/${workspace}/applications`,
    );
    await page
      .getByRole("button", {
        name: "Checklist app checklist template",
        exact: true,
      })
      .click();
    let modal = page.getByRole("dialog");
    await modal
      .getByRole("button", { name: "Add checklist item", exact: true })
      .click();
    await modal
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Smoke check");
    await modal
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Verify the release flow");
    await modal
      .getByRole("button", { name: "Apply item", exact: true })
      .click();
    const templateResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/checklist-template") &&
        response.request().method() === "PATCH",
    );
    await modal
      .getByRole("button", { name: "Save template", exact: true })
      .click();
    expect((await templateResponse).status()).toBe(200);
    await expect(
      modal.getByText("Checklist template saved.", { exact: true }),
    ).toBeVisible();
    const createdResponse = await request.post(`${base}/releases`, {
      headers,
      data: { ...releaseInput, version: "1.0.1" },
    });
    expect(createdResponse.status()).toBe(201);
    const release = await createdResponse.json();
    const readinessPath = `${base}/releases/${release.id}/readiness`;
    const original = await (
      await request.get(readinessPath, { headers })
    ).json();
    expect(original.items).toHaveLength(1);
    const item = original.items[0];
    expect(original.template_revision).toBe(1);
    await modal
      .getByRole("button", {
        name: "Edit checklist item Smoke check",
        exact: true,
      })
      .click();
    await modal
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Future check");
    await modal
      .getByRole("button", { name: "Apply item", exact: true })
      .click();
    const updatedTemplate = page.waitForResponse(
      (response) =>
        response.url().endsWith("/checklist-template") &&
        response.request().method() === "PATCH",
    );
    await modal
      .getByRole("button", { name: "Save template", exact: true })
      .click();
    expect((await updatedTemplate).status()).toBe(200);
    expect(
      (await (await request.get(readinessPath, { headers })).json()).items,
    ).toEqual(original.items);
    expect(
      (
        await (
          await request.get(`${base}/releases/${empty.id}/readiness`, {
            headers,
          })
        ).json()
      ).items,
    ).toEqual([]);
    const template = await (
      await request.get(templatePath, { headers })
    ).json();
    expect(
      (await request.patch(templatePath, { headers, data: template })).status(),
    ).toBe(200);
    const staleSave = page.waitForResponse(
      (response) =>
        response.url().endsWith("/checklist-template") &&
        response.request().method() === "PATCH",
    );
    await modal
      .getByRole("button", { name: "Save template", exact: true })
      .click();
    expect((await staleSave).status()).toBe(409);
    await expect(modal.getByRole("alert")).toContainText(
      "Checklist template changed",
    );
    await modal
      .getByRole("button", {
        name: "Reload template (discard local edits)",
        exact: true,
      })
      .click();
    await expect(
      modal.getByText("Checklist template revision 3", { exact: true }),
    ).toBeVisible();
    await expect(modal.getByRole("alert")).toHaveCount(0);
    expect(
      (
        await request.patch(templatePath, {
          headers,
          data: { ...template, revision: 1 },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await request.patch(
          `${base}/applications/${foreignApp}/checklist-template`,
          { headers, data: { revision: 0, items: [] } },
        )
      ).status(),
    ).toBe(404);
    await page.goto(
      `http://127.0.0.1:5320/shiplog/workspaces/${workspace}/releases/${release.id}`,
    );
    const qa = page.getByRole("button", { name: "QA", exact: true });
    await expect(qa).toHaveAttribute("data-qa-complete", "false");
    await qa.click();
    modal = page.getByRole("dialog");
    const checkbox = modal.getByRole("checkbox", {
      name: "Smoke check",
      exact: true,
    });
    const completion = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/checklist/${item.id}`) &&
        response.request().method() === "PATCH",
    );
    await checkbox.check();
    expect((await completion).status()).toBe(200);
    await expect(checkbox).toBeChecked();
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await expect(qa).toHaveAttribute("data-qa-complete", "true");
    await page.reload();
    await expect(qa).toHaveAttribute("data-qa-complete", "true");
    await qa.click();
    await expect(
      page.getByRole("checkbox", { name: "Smoke check", exact: true }),
    ).toBeChecked();
    expect(
      localSQL(
        `SELECT completed_by IS NULL FROM public.shiplog_checklist_items WHERE id='${item.id}';`,
      ),
    ).toBe("t");
    expect(
      localSQL(
        `SELECT actor_id FROM platform.shiplog_checklist_completions WHERE item_id='${item.id}';`,
      ),
    ).toBe(account.id);
    const completionPath = `${base}/releases/${release.id}/checklist/${item.id}`;
    expect(
      (
        await request.patch(
          `${base}/releases/${empty.id}/checklist/${item.id}`,
          { headers, data: { completed: true } },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.patch(completionPath, {
          headers,
          data: { completed: "false" },
        })
      ).status(),
    ).toBe(400);
    localPermission("grant", account.id, "shiplog", workspace, "editor");
    expect(
      (await request.patch(templatePath, { headers, data: template })).status(),
    ).toBe(403);
    await page.goto(
      `http://127.0.0.1:5320/shiplog/workspaces/${workspace}/applications`,
    );
    await expect(
      page.getByRole("button", {
        name: "Checklist app checklist template",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (
        await request.patch(completionPath, {
          headers,
          data: { completed: false },
        })
      ).status(),
    ).toBe(200);
    localPermission("grant", account.id, "shiplog", workspace, "viewer");
    await page.goto(
      `http://127.0.0.1:5320/shiplog/workspaces/${workspace}/releases/${release.id}`,
    );
    await qa.click();
    await expect(
      page.getByRole("checkbox", { name: "Smoke check", exact: true }),
    ).toBeDisabled();
    expect(
      (
        await request.patch(completionPath, {
          headers,
          data: { completed: true },
        })
      ).status(),
    ).toBe(403);
    localPermission("grant", account.id, "shiplog", workspace, "external");
    await page.reload();
    await expect(qa).toHaveCount(0);
    expect((await request.get(readinessPath, { headers })).status()).toBe(403);
    expect((await request.get(templatePath, { headers })).status()).toBe(403);
    expect(
      localSQL(
        `SELECT status FROM public.shiplog_releases WHERE id='${release.id}';`,
      ),
    ).toBe("released");
  } finally {
    removeLocalAccount(account.id);
    localSQL(`BEGIN; DELETE FROM public.shiplog_releases WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.shiplog_applications WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}');
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
  }
});
