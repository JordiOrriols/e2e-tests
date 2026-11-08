import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Planner editors use the existing marker manager through the API; viewers and external users cannot edit", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID();
  const path = `/api/planner/workspaces/${workspace}/markers`;
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
      VALUES('${workspace}','${owner}','Local marker E2E','2026-02-02'); COMMIT;`);
    for (const role of ["external", "viewer"]) {
      localPermission("grant", account.id, "planner", workspace, role);
      await page.goto(
        `http://127.0.0.1:5320/planner/workspaces/${workspace}/roadmap`,
      );
      await expect(
        page.getByRole("heading", { name: "Local marker E2E", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Manage markers", exact: true }),
      ).toHaveCount(0);
      expect(
        (
          await request.post(path, {
            headers,
            data: { name: "Denied", date: "2026-02-04" },
          })
        ).status(),
      ).toBe(403);
    }
    localPermission("grant", account.id, "planner", workspace, "editor");
    await page.reload();
    await page
      .getByRole("button", { name: "Manage markers", exact: true })
      .click();
    const manager = page.getByRole("dialog");
    await manager.getByLabel("Marker name", { exact: true }).fill("Launch");
    await manager.getByLabel("Marker date", { exact: true }).fill("2026-02-04");
    await manager
      .getByRole("button", { name: "Add marker", exact: true })
      .click();
    await expect(
      manager.getByRole("button", { name: "Edit marker Launch", exact: true }),
    ).toBeVisible();
    const created = await (await request.get(path, { headers })).json();
    expect(created).toHaveLength(1);
    await manager
      .getByRole("button", { name: "Edit marker Launch", exact: true })
      .click();
    await manager
      .getByRole("textbox", { name: "Marker name", exact: true })
      .last()
      .fill("Release");
    await manager.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(
      manager.getByRole("button", { name: "Edit marker Release", exact: true }),
    ).toBeVisible();
    const renamed = await (await request.get(path, { headers })).json();
    expect(renamed).toEqual([{ ...created[0], name: "Release" }]);
    const official = await (
      await request.get(`/api/planner/workspaces/${workspace}/roadmap`, {
        headers,
      })
    ).json();
    expect(official.markers).toEqual([{ name: "Release", date: "2026-02-04" }]);
    expect(
      (
        await request.patch(`${path}/${created[0].id}`, {
          headers,
          data: { name: "" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post(path, {
          headers,
          data: { name: "Invalid", date: "2026-02-30" },
        })
      ).status(),
    ).toBe(400);
    await manager
      .getByRole("button", { name: "Delete marker Release", exact: true })
      .click();
    await expect(
      manager.getByText("No markers yet. Add an important date above.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await (await request.get(path, { headers })).json()).toEqual([]);
    expect(
      (await request.delete(`${path}/${created[0].id}`, { headers })).status(),
    ).toBe(404);
    localPermission("revoke", account.id, "planner", workspace);
    expect((await request.get(path, { headers })).status()).toBe(403);
    expect(
      (
        await request.patch(`${path}/${created[0].id}`, {
          headers,
          data: { name: "Denied" },
        })
      ).status(),
    ).toBe(403);
  } finally {
    removeLocalAccount(account.id);
    localSQL(`BEGIN; DELETE FROM public.roadmap_markers WHERE workspace_id='${workspace}';
      DELETE FROM public.workspaces WHERE id='${workspace}'; DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
  }
});
