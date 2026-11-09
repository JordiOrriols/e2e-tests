import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("linked employees read only their own redacted evaluation history without directory grants", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const employee = await createLocalAccount(
    request,
    `local-e2e-employee-${randomUUID()}`,
  );
  const sameEmail = await createLocalAccount(
    request,
    `local-e2e-employee-${randomUUID()}`,
  );
  const legacy = randomUUID(),
    workspace = randomUUID(),
    team = randomUUID(),
    member = randomUUID(),
    foreignMember = randomUUID();
  const api = `/api/ladders/me/members/${member}/evaluations`;
  await page.setExtraHTTPHeaders(employee.headers);
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${legacy}','Employee workspace');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${legacy}','${workspace}','Employee team');
      INSERT INTO public.members(id,team_id,name) VALUES('${member}','${team}','Employee profile'),('${foreignMember}','${team}','Other profile');
      SELECT set_config('members.claiming','${member}',true);
      UPDATE public.members SET user_id='${legacy}' WHERE id='${member}';
      INSERT INTO public.evaluations(member_id,kind,status,comments,comment_visibility,created_at) VALUES
      ('${member}','self','draft','{"Technology":"My private draft"}','{}','2026-10-01'),
      ('${member}','manager','draft','{"Technology":"Private manager draft"}','{}','2026-10-02'),
      ('${member}','peer','draft','{"Technology":"Private peer draft"}','{}','2026-10-03'),
      ('${member}','peer','published','{"Technology":"Visible peer","People":"Hidden peer"}','{"Technology":true}','2026-10-04'),
      ('${member}','manager','published','{"Technology":"Visible manager","People":"Hidden manager"}','{"People":false}','2026-10-05'); COMMIT;`);
    expect((await request.get(api)).status()).toBe(401);
    expect(
      (await request.get(api, { headers: employee.headers })).status(),
    ).toBe(404);
    localPermission("map-legacy", employee.account.id, legacy);
    const response = await request.get(api, { headers: employee.headers });
    expect(response.status()).toBe(200);
    const snapshot = await response.json();
    expect(snapshot.member.id).toBe(member);
    expect(snapshot.evaluations).toHaveLength(3);
    for (const evaluation of snapshot.evaluations)
      expect(evaluation.comment_visibility).toEqual({});
    const json = JSON.stringify(snapshot);
    for (const hidden of [
      "Private manager draft",
      "Private peer draft",
      "Hidden manager",
      "Hidden peer",
      legacy,
      "view_token",
      "self_token",
      "peer_token",
    ])
      expect(json).not.toContain(hidden);
    expect(json).toContain("My private draft");
    expect(json).toContain("Visible peer");
    expect(
      (
        await request.get(`/api/ladders/workspaces/${workspace}/teams`, {
          headers: employee.headers,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.get(
          `/api/ladders/me/members/${foreignMember}/evaluations`,
          { headers: employee.headers },
        )
      ).status(),
    ).toBe(404);
    localPermission(
      "grant",
      sameEmail.account.id,
      "ladders",
      workspace,
      "owner",
    );
    expect(
      (await request.get(api, { headers: sameEmail.headers })).status(),
    ).toBe(404);
    expect(
      await (
        await request.get("/api/ladders/me/members", {
          headers: sameEmail.headers,
        })
      ).json(),
    ).toEqual([]);
    await page.goto("http://127.0.0.1:5320/ladders/");
    await page
      .getByRole("link", { name: "My evaluations", exact: true })
      .click();
    await page
      .getByRole("link", {
        name: "Employee workspace - Employee profile",
        exact: true,
      })
      .click();
    await expect(page.getByTestId("evaluation-viewer")).toBeVisible();
    await expect(page.getByTestId("version-row")).toHaveCount(3);
    await expect(
      page.getByText("Visible manager", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Comments shared with the employee" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("version-delete")).toHaveCount(0);
    const ownDraft = page
      .getByTestId("version-row")
      .filter({ has: page.locator('[data-status="draft"]') });
    await ownDraft.locator("button[aria-current], button.text-left").click();
    await expect(
      page.getByText("My private draft", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("evaluation-viewer")).toBeVisible();
    localPermission("unmap-legacy", employee.account.id, legacy);
    expect(
      (await request.get(api, { headers: employee.headers })).status(),
    ).toBe(404);
    await page.reload();
    await expect(page.getByTestId("evaluation-viewer")).toHaveCount(0);
    expect(
      (
        await request.get(`/api/ladders/workspaces/${workspace}/teams`, {
          headers: sameEmail.headers,
        })
      ).status(),
    ).toBe(200);
  } finally {
    localSQL(`BEGIN;
      DELETE FROM platform.legacy_account_mappings WHERE legacy_user_id='${legacy}';
      DELETE FROM platform.grants WHERE workspace_id='${workspace}';
      DELETE FROM public.members WHERE team_id='${team}';
      DELETE FROM public.teams WHERE workspace_id='${workspace}';
      DELETE FROM public.workspaces WHERE id='${workspace}';
      DELETE FROM auth.users WHERE id='${legacy}'; COMMIT;`);
    removeLocalAccount(employee.account.id);
    removeLocalAccount(sameEmail.account.id);
  }
});
