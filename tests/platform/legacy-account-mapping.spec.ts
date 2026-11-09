import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("legacy account mapping is explicit and never grants another same-email subject access", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const first = await createLocalAccount(
    request,
    `local-e2e-mapping-${randomUUID()}`,
  );
  const second = await createLocalAccount(
    request,
    `local-e2e-mapping-${randomUUID()}`,
  );
  const legacy = randomUUID(),
    workspace = randomUUID(),
    team = randomUUID();
  const path = `/api/ladders/workspaces/${workspace}/teams`;
  await page.setExtraHTTPHeaders(first.headers);
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
    localSQL(`BEGIN; SELECT set_config('request.jwt.claim.sub','${legacy}',true);
      INSERT INTO auth.users(id,email) VALUES('${legacy}','platform-e2e@example.com');
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${legacy}','Mapped legacy workspace');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${legacy}','${workspace}','Mapping team'); COMMIT;`);
    expect(first.account.id).not.toBe(second.account.id);
    for (const { headers } of [first, second])
      expect((await request.get(path, { headers })).status()).toBe(403);

    localPermission("map-legacy", first.account.id, legacy);
    localPermission("map-legacy", first.account.id, legacy);
    expect(
      localSQL(
        `SELECT count(*) FROM platform.legacy_account_mappings WHERE user_id='${first.account.id}' AND legacy_user_id='${legacy}'`,
      ),
    ).toBe("1");
    expect(() =>
      localPermission("map-legacy", second.account.id, legacy),
    ).toThrow();
    for (const { headers } of [first, second])
      expect((await request.get(path, { headers })).status()).toBe(403);
    await page.goto("http://127.0.0.1:5320/ladders/");
    await expect(
      page.getByText("No Ladders workspace access.", { exact: false }),
    ).toBeVisible();

    localPermission("grant", first.account.id, "ladders", workspace, "owner");
    await page.reload();
    await page
      .getByRole("link", { name: "Mapped legacy workspace", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Mapping team", exact: true }),
    ).toBeVisible();
    expect(
      (await request.get(path, { headers: second.headers })).status(),
    ).toBe(403);
    const account = await (
      await request.get("/api/me", { headers: first.headers })
    ).json();
    expect(Object.keys(account).sort()).toEqual(["email", "grants", "id"]);

    localPermission("unmap-legacy", first.account.id, legacy);
    expect((await request.get(path, { headers: first.headers })).status()).toBe(
      200,
    );
    localPermission("revoke", first.account.id, "ladders", workspace);
    expect((await request.get(path, { headers: first.headers })).status()).toBe(
      403,
    );
    expect(
      localSQL(
        `SELECT owner_id FROM public.workspaces WHERE id='${workspace}'`,
      ),
    ).toBe(legacy);
  } finally {
    localSQL(`BEGIN;
      DELETE FROM platform.legacy_account_mappings WHERE legacy_user_id='${legacy}';
      DELETE FROM platform.grants WHERE workspace_id='${workspace}';
      DELETE FROM public.teams WHERE workspace_id='${workspace}';
      DELETE FROM public.workspaces WHERE id='${workspace}';
      DELETE FROM auth.users WHERE id='${legacy}'; COMMIT;`);
    removeLocalAccount(first.account.id);
    removeLocalAccount(second.account.id);
  }
});
