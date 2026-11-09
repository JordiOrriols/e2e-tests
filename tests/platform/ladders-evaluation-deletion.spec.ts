import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Ladders evaluation deletion reuses owner confirmation and preserves private self drafts", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-ladders-evaluation-delete-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    team = randomUUID(),
    member = randomUUID(),
    managerDraft = randomUUID(),
    managerPublished = randomUUID(),
    peer = randomUUID(),
    selfPublished = randomUUID(),
    selfDraft = randomUUID();
  const base = `/api/ladders/workspaces/${workspace}/members/${member}/evaluations`;
  const url = `http://127.0.0.1:5320/ladders/workspaces/${workspace}/members/${member}/evaluations`;
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
    localSQL(`BEGIN; SELECT set_config('request.jwt.claim.sub','${owner}',true);
      INSERT INTO auth.users(id) VALUES('${owner}');
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Evaluation deletion');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','Deletion team');
      INSERT INTO public.members(id,team_id,name) VALUES('${member}','${team}','Deletion member');
      INSERT INTO public.evaluations(id,member_id,kind,status,author_name,current_levels,comments,created_at) VALUES
      ('${managerDraft}','${member}','manager','draft',null,'{"Technology":3}','{"Technology":"Manager draft"}','2026-11-01'),
      ('${managerPublished}','${member}','manager','published',null,'{"Technology":2}','{"Technology":"Published manager"}','2026-11-02'),
      ('${peer}','${member}','peer','published','Reviewer','{}','{"Technology":"Peer note"}','2026-11-03'),
      ('${selfPublished}','${member}','self','published',null,'{}','{"Technology":"Self note"}','2026-11-04'),
      ('${selfDraft}','${member}','self','draft',null,'{}','{"Technology":"Private self draft"}','2026-11-05'); COMMIT;`);

    expect(
      (await request.delete(`${base}/${managerDraft}`, { headers })).status(),
    ).toBe(403);
    localPermission("grant", account.id, "ladders", workspace, "viewer");
    await page.goto(url);
    await expect(page.getByTestId("evaluation-viewer")).toBeVisible();
    await expect(page.getByTestId("version-delete")).toHaveCount(0);
    expect(
      (await request.delete(`${base}/${managerDraft}`, { headers })).status(),
    ).toBe(403);
    localPermission("grant", account.id, "ladders", workspace, "editor");
    await page.reload();
    await expect(page.getByTestId("version-delete")).toHaveCount(0);
    expect(
      (await request.delete(`${base}/${managerDraft}`, { headers })).status(),
    ).toBe(403);

    localPermission("grant", account.id, "ladders", workspace, "owner");
    await page.reload();
    await expect(page.getByTestId("version-delete")).toHaveCount(4);
    await expect(page.getByText("Private self draft")).toHaveCount(0);
    expect(
      (await request.delete(`${base}/${selfDraft}`, { headers })).status(),
    ).toBe(404);
    const draftRow = page.locator('[data-testid="version-row"]').filter({
      has: page.locator('[data-testid="version-status"][data-status="draft"]'),
    });
    await draftRow.getByTestId("version-delete").click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("Delete this version?");
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    expect(
      localSQL(
        `SELECT count(*) FROM public.evaluations WHERE id='${managerDraft}'`,
      ),
    ).toBe("1");

    const save = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/evaluations/${managerDraft}`) &&
        response.request().method() === "PATCH",
    );
    const removeDraft = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/evaluations/${managerDraft}`) &&
        response.request().method() === "DELETE",
    );
    await page.getByTestId("level-current-Technology-4").click();
    await draftRow.getByTestId("version-delete").click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();
    expect((await save).status()).toBe(200);
    expect((await removeDraft).status()).toBe(200);
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(draftRow).toHaveCount(0);
    expect(
      localSQL(
        `SELECT count(*) FROM public.evaluations WHERE id='${managerDraft}'`,
      ),
    ).toBe("0");

    const deletePublished = async (
      id: string,
      row: ReturnType<typeof page.getByTestId>,
    ) => {
      const response = page.waitForResponse(
        (item) =>
          item.url().endsWith(`/evaluations/${id}`) &&
          item.request().method() === "DELETE",
      );
      await row.getByTestId("version-delete").click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete" })
        .click();
      expect((await response).status()).toBe(200);
      await expect(page.getByRole("alertdialog")).toBeHidden();
    };
    const peerRow = page.getByTestId("version-row").filter({
      has: page.getByTestId("version-author").filter({ hasText: "Reviewer" }),
    });
    await deletePublished(peer, peerRow);
    const selfRow = page.getByTestId("version-row").filter({
      has: page.getByTestId("version-author").filter({ hasText: "Self" }),
    });
    await deletePublished(selfPublished, selfRow);
    await expect(page.getByTestId("version-delete")).toHaveCount(1);
    localPermission("revoke", account.id, "ladders", workspace);
    const remainingManager = page.getByTestId("version-row").filter({
      has: page.getByTestId("version-author").filter({ hasText: "Manager" }),
    });
    const deniedDelete = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/evaluations/${managerPublished}`) &&
        response.request().method() === "DELETE",
    );
    await remainingManager.getByTestId("version-delete").click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();
    expect((await deniedDelete).status()).toBe(403);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    expect(
      localSQL(
        `SELECT string_agg(id::text,',' ORDER BY id) FROM public.evaluations WHERE member_id='${member}'`,
      ),
    ).toBe([managerPublished, selfDraft].sort().join(","));
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE workspace_id='${workspace}';
      DELETE FROM public.members WHERE id='${member}'; DELETE FROM public.teams WHERE workspace_id='${workspace}';
      DELETE FROM public.workspaces WHERE id='${workspace}'; DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
    removeLocalAccount(account.id);
  }
});
