import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Shiplog approvals reuse thumbs controls with independent verified identities and scoped history", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-shiplog-decisions-${randomUUID()}`,
  );
  const second = await createLocalAccount(
    request,
    `local-e2e-shiplog-second-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    other = randomUUID(),
    app = randomUUID(),
    release = randomUUID();
  const path = `/api/shiplog/workspaces/${workspace}/releases/${release}`;
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Approval workspace'),('${other}','${owner}','Other approval workspace');
      INSERT INTO public.shiplog_applications(id,workspace_id,name) VALUES('${app}','${workspace}','Approval app');
      INSERT INTO public.shiplog_releases(id,workspace_id,application_id,version,release_type,title,status) VALUES('${release}','${workspace}','${app}','1.0.0','major','Approved history','released');
      INSERT INTO public.shiplog_release_decisions(release_id,user_id,approved) VALUES('${release}','${owner}',true); COMMIT;`);
    localPermission("grant", account.id, "shiplog", workspace, "viewer");
    localPermission("grant", second.account.id, "shiplog", workspace, "editor");
    await page.goto(
      `http://127.0.0.1:5320/shiplog/workspaces/${workspace}/releases/${release}`,
    );
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    const disapprove = page.getByRole("button", {
      name: "Disapprove",
      exact: true,
    });
    await expect(approve).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "New release", exact: true }),
    ).toHaveCount(0);
    const approved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/decision") &&
        response.request().method() === "PATCH",
    );
    await approve.click();
    expect((await approved).status()).toBe(200);
    await expect(approve).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("listitem", {
        name: "platform-e2e: Approved",
        exact: true,
      }),
    ).toHaveCount(1);
    await page.reload();
    await expect(approve).toHaveAttribute("aria-pressed", "true");
    expect(
      (
        await request.patch(`${path}/decision`, {
          headers: second.headers,
          data: { approved: false, user_id: account.id },
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await expect(approve).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("listitem", {
        name: "platform-e2e: Disapproved",
        exact: true,
      }),
    ).toHaveCount(1);
    const denied = page.waitForResponse(
      (response) =>
        response.url().endsWith("/decision") &&
        response.request().method() === "PATCH",
    );
    await disapprove.click();
    expect((await denied).status()).toBe(200);
    await expect(disapprove).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("listitem", {
        name: "platform-e2e: Disapproved",
        exact: true,
      }),
    ).toHaveCount(2);
    const directory = await (
      await request.get(`${path}/decisions`, { headers })
    ).json();
    expect(directory.account_id).toBe(account.id);
    expect(
      directory.decisions
        .map((entry: { user_id: string }) => entry.user_id)
        .sort(),
    ).toEqual([account.id, second.account.id].sort());
    expect(
      directory.decisions.every((entry: object) => !("email" in entry)),
    ).toBe(true);
    expect(
      (
        await request.patch(`${path}/decision`, {
          headers,
          data: { approved: "true" },
        })
      ).status(),
    ).toBe(400);
    localPermission("grant", account.id, "shiplog", other, "owner");
    expect(
      (
        await request.patch(
          `/api/shiplog/workspaces/${other}/releases/${release}/decision`,
          { headers, data: { approved: true } },
        )
      ).status(),
    ).toBe(404);
    localPermission("revoke", second.account.id, "shiplog", workspace);
    await page.reload();
    await expect(
      page.getByRole("listitem", {
        name: "platform-e2e: Disapproved",
        exact: true,
      }),
    ).toHaveCount(1);
    expect(
      localSQL(
        `SELECT count(*) FROM platform.shiplog_release_decisions WHERE release_id='${release}';`,
      ),
    ).toBe("2");
    localPermission("grant", account.id, "shiplog", workspace, "external");
    await page.reload();
    await expect(approve).toHaveCount(0);
    expect((await request.get(`${path}/decisions`, { headers })).status()).toBe(
      403,
    );
    expect(
      (
        await request.patch(`${path}/decision`, {
          headers,
          data: { approved: true },
        })
      ).status(),
    ).toBe(403);
    expect(
      localSQL(
        `SELECT status FROM public.shiplog_releases WHERE id='${release}';`,
      ),
    ).toBe("released");
    expect(
      localSQL(
        `SELECT approved FROM public.shiplog_release_decisions WHERE release_id='${release}' AND user_id='${owner}';`,
      ),
    ).toBe("t");
    expect(
      localSQL(
        `SELECT count(*) FROM platform.shiplog_audit_events WHERE workspace_id='${workspace}' AND event='release.decision';`,
      ),
    ).toBe("3");
  } finally {
    removeLocalAccount(account.id);
    removeLocalAccount(second.account.id);
    localSQL(`BEGIN; DELETE FROM public.shiplog_releases WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.shiplog_applications WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}');
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
  }
});
