import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Shiplog audit history paginates workspace events and distinguishes unmapped legacy actors", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-shiplog-audit-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    other = randomUUID(),
    foreign = randomUUID();
  const path = `/api/shiplog/workspaces/${workspace}/audit`;
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Audit workspace'),('${other}','${owner}','Other audit workspace');
      INSERT INTO platform.shiplog_audit_events(workspace_id,actor_id,event,details,created_at)
      SELECT '${workspace}','${account.id}','release.updated',jsonb_build_object('title','Local audited title','n',n),'2026-11-08T12:00:00Z'::timestamptz FROM generate_series(1,51) n;
      INSERT INTO public.shiplog_audit_events(workspace_id,actor_id,event,details,created_at)
      VALUES('${workspace}','${owner}','legacy.release.created','{"title":"Imported release"}','2026-11-07T12:00:00Z');
      INSERT INTO platform.shiplog_audit_events(id,workspace_id,actor_id,event,details)
      VALUES('${foreign}','${other}','${account.id}','Foreign private event','{}'); COMMIT;`);
    expect((await request.get(path, { headers })).status()).toBe(403);
    localPermission("grant", account.id, "shiplog", workspace, "viewer");
    await page.goto("http://127.0.0.1:5320/shiplog/");
    await page
      .getByRole("link", { name: "Audit history", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Audit history", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main ol > li")).toHaveCount(50);
    await expect(
      page.getByText("Foreign private event", { exact: true }),
    ).toHaveCount(0);
    const first = await (await request.get(path, { headers })).json();
    const keys = first.events.map(
      (event: { source: string; id: string }) => `${event.source}:${event.id}`,
    );
    await page.getByText("Event details", { exact: true }).first().click();
    await expect(page.getByText(/Local audited title/).first()).toBeVisible();
    await page
      .getByRole("button", { name: "Load more events", exact: true })
      .click();
    await expect(page.locator("main ol > li")).toHaveCount(52);
    await expect(page.getByText(/Legacy account \(unmapped\)/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Load more events", exact: true }),
    ).toHaveCount(0);
    const next = await (
      await request.get(
        `${path}?cursor=${encodeURIComponent(first.next_cursor)}`,
        { headers },
      )
    ).json();
    expect(next.events).toHaveLength(2);
    expect(next.next_cursor).toBeNull();
    expect(
      new Set([
        ...keys,
        ...next.events.map(
          (event: { source: string; id: string }) =>
            `${event.source}:${event.id}`,
        ),
      ]).size,
    ).toBe(52);
    expect(
      (await request.get(`${path}?cursor=bad`, { headers })).status(),
    ).toBe(400);
    expect(
      (
        await request.get(`${path}?cursor=platform:${foreign}`, { headers })
      ).status(),
    ).toBe(404);
    await page.reload();
    await expect(page.locator("main ol > li")).toHaveCount(50);
    localPermission("grant", account.id, "shiplog", workspace, "external");
    await page.reload();
    await expect(page.locator("main ol > li")).toHaveCount(0);
    await expect(page.getByRole("alert")).toBeVisible();
    expect((await request.get(path, { headers })).status()).toBe(403);
    await page.goto(
      `http://127.0.0.1:5320/shiplog/workspaces/${workspace}/releases`,
    );
    await expect(
      page.getByRole("link", { name: "Audit history", exact: true }),
    ).toHaveCount(0);
    localPermission("revoke", account.id, "shiplog", workspace);
    expect((await request.get(path, { headers })).status()).toBe(403);
    expect(
      localSQL(
        `SELECT count(*) FROM platform.shiplog_audit_events WHERE workspace_id='${workspace}';`,
      ),
    ).toBe("51");
  } finally {
    removeLocalAccount(account.id);
    localSQL(`BEGIN; DELETE FROM public.shiplog_audit_events WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}');
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
  }
});
