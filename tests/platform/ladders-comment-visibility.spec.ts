import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Ladders reuses comment sharing controls for every evaluation kind with scoped metadata-only writes", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-ladders-visibility-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    team = randomUUID(),
    member = randomUUID(),
    secondMember = randomUUID();
  const manager = randomUUID(),
    peer = randomUUID(),
    self = randomUUID(),
    privateSelf = randomUUID();
  const base = `/api/ladders/workspaces/${workspace}/members/${member}/evaluations`;
  const path = (id: string, category = "Technology") =>
    `${base}/${id}/comments/${category}`;
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Local visibility');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','Visibility team');
      INSERT INTO public.members(id,team_id,name) VALUES('${member}','${team}','Visibility member'),('${secondMember}','${team}','Second member');
      INSERT INTO public.evaluations(id,member_id,kind,status,author_name,comments,created_at) VALUES
      ('${manager}','${member}','manager','published',null,'{"Technology":"Manager note","People":"Other manager note"}','2026-10-01'),
      ('${peer}','${member}','peer','published','Reviewer','{"Technology":"Peer note"}','2026-10-02'),
      ('${self}','${member}','self','published',null,'{"Technology":"Self note"}','2026-10-03'),
      ('${privateSelf}','${member}','self','draft',null,'{"Technology":"Private draft"}','2026-10-04'); COMMIT;`);
    const before = localSQL(
      `SELECT jsonb_agg(to_jsonb(e)-'comment_visibility' ORDER BY id)::text FROM public.evaluations e WHERE member_id='${member}'`,
    );
    expect(
      (
        await request.patch(path(peer), { headers, data: { visible: true } })
      ).status(),
    ).toBe(403);
    localPermission("grant", account.id, "ladders", workspace, "viewer");
    const url = `http://127.0.0.1:5320/ladders/workspaces/${workspace}/members/${member}/evaluations`;
    await page.goto(url);
    await expect(page.getByTestId("evaluation-viewer")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Comments shared with the employee" }),
    ).toHaveCount(0);
    expect(
      (
        await request.patch(path(peer), { headers, data: { visible: true } })
      ).status(),
    ).toBe(403);
    localPermission("grant", account.id, "ladders", workspace, "editor");
    await page.reload();
    const panel = page.getByRole("region", {
      name: "Comments shared with the employee",
    });
    await expect(panel).toBeVisible();
    const toggle = (id: string, category = "Technology") =>
      page.getByTestId(`comment-visibility-${id}-${category}`);
    await expect(toggle(peer)).toHaveText("Share with employee");
    await expect(toggle(manager)).toHaveText("Hide from employee");
    await expect(toggle(self)).toHaveText("Hide from employee");
    await expect(toggle(privateSelf)).toHaveCount(0);
    const change = async (id: string, text: string) => {
      const response = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/${id}/comments/Technology`) &&
          response.request().method() === "PATCH",
      );
      await toggle(id).click();
      expect((await response).status()).toBe(200);
      await expect(toggle(id)).toHaveText(text);
    };
    await change(peer, "Hide from employee");
    await change(manager, "Share with employee");
    await change(self, "Share with employee");
    await expect(toggle(manager, "People")).toHaveText("Hide from employee");
    await page.reload();
    await expect(toggle(peer)).toHaveText("Hide from employee");
    await expect(toggle(manager)).toHaveText("Share with employee");
    await expect(toggle(self)).toHaveText("Share with employee");
    await change(peer, "Share with employee");
    expect(
      (
        await request.patch(path(manager, "Unknown"), {
          headers,
          data: { visible: true },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.patch(path(manager, "System"), {
          headers,
          data: { visible: true },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.patch(path(privateSelf), {
          headers,
          data: { visible: true },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.patch(
          `/api/ladders/workspaces/${workspace}/members/${secondMember}/evaluations/${peer}/comments/Technology`,
          { headers, data: { visible: true } },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.patch(path(peer), { headers, data: { visible: "true" } })
      ).status(),
    ).toBe(400);
    localPermission("revoke", account.id, "ladders", workspace);
    const denied = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/${peer}/comments/Technology`) &&
        response.request().method() === "PATCH",
    );
    await toggle(peer).click();
    expect((await denied).status()).toBe(403);
    await expect(panel.getByRole("alert")).toContainText(
      "You do not have permission",
    );
    await expect(toggle(peer)).toHaveText("Share with employee");
    expect(
      localSQL(
        `SELECT jsonb_agg(to_jsonb(e)-'comment_visibility' ORDER BY id)::text FROM public.evaluations e WHERE member_id='${member}'`,
      ),
    ).toBe(before);
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE workspace_id='${workspace}';
      DELETE FROM public.members WHERE id IN ('${member}','${secondMember}');
      DELETE FROM public.teams WHERE workspace_id='${workspace}';
      DELETE FROM public.workspaces WHERE id='${workspace}';
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
    removeLocalAccount(account.id);
  }
});
