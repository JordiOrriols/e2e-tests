import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Ladders reuses autosaving manager editor with immutable published history and independent peer review", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-ladders-editing-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    team = randomUUID(),
    member = randomUUID();
  const published = randomUUID(),
    peer = randomUUID(),
    self = randomUUID();
  const base = `/api/ladders/workspaces/${workspace}/members/${member}/evaluations`;
  const input = {
    current_levels: { Technology: 3 },
    goal_levels: { Technology: 4 },
    comments: { Technology: "Draft input" },
  };
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Local editing');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','Editing team');
      INSERT INTO public.members(id,team_id,name) VALUES('${member}','${team}','Editing member');
      INSERT INTO public.evaluations(id,member_id,kind,status,author_name,current_levels,comments,comment_visibility,created_at) VALUES
      ('${published}','${member}','manager','published',null,'{"Technology":2}','{"Technology":"Original manager note"}','{"Technology":false}','2026-11-01'),
      ('${peer}','${member}','peer','draft','Reviewer','{}','{"Technology":"Peer note"}','{}','2026-11-02'),
      ('${self}','${member}','self','published',null,'{}','{"Technology":"Self note"}','{}','2026-11-03'); COMMIT;`);
    const before = localSQL(
      `SELECT to_jsonb(e)::text FROM public.evaluations e WHERE id='${published}'`,
    );
    const url = `http://127.0.0.1:5320/ladders/workspaces/${workspace}/members/${member}/evaluations`;
    expect((await request.post(base, { headers, data: input })).status()).toBe(
      403,
    );
    localPermission("grant", account.id, "ladders", workspace, "viewer");
    await page.goto(url);
    await expect(page.getByTestId("evaluation-viewer")).toBeVisible();
    await expect(page.getByTestId("assessment-competencies")).toHaveCount(0);
    localPermission("grant", account.id, "ladders", workspace, "editor");
    await page.reload();
    await expect(page.getByTestId("assessment-competencies")).toBeVisible();
    await expect(page.getByTestId("manager-evaluation-publish")).toBeDisabled();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}/evaluations`) &&
        response.request().method() === "POST",
    );
    await page.getByTestId("level-current-Technology-3").click();
    const created = await (await saved).json();
    expect(created.kind).toBe("manager");
    expect(created.status).toBe("draft");
    await expect(page.getByTestId("evaluation-autosave")).toHaveText(
      "Draft saved",
    );
    expect(created.comment_visibility).toEqual({ Technology: false });
    await page.reload();
    await expect(page.getByTestId("evaluation-autosave")).toHaveText(
      "Draft saved",
    );
    const updated = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/evaluations/${created.id}`) &&
        response.request().method() === "PATCH",
    );
    await page.getByTestId("level-goal-Technology-4").click();
    expect((await updated).status()).toBe(200);
    await expect(page.getByTestId("evaluation-autosave")).toHaveText(
      "Draft saved",
    );
    const publishedResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/evaluations/${created.id}/status`),
    );
    await page.getByTestId("manager-evaluation-publish").click();
    expect((await publishedResponse).status()).toBe(200);
    expect(
      localSQL(
        `SELECT status FROM public.evaluations WHERE id='${created.id}'`,
      ),
    ).toBe("published");
    expect(
      localSQL(
        `SELECT to_jsonb(e)::text FROM public.evaluations e WHERE id='${published}'`,
      ),
    ).toBe(before);
    expect(
      (
        await request.patch(`${base}/${created.id}`, { headers, data: input })
      ).status(),
    ).toBe(409);
    expect(
      (
        await request.patch(`${base}/${self}/status`, {
          headers,
          data: { status: "draft" },
        })
      ).status(),
    ).toBe(404);
    const peerRow = page
      .getByTestId("version-row")
      .filter({ hasText: "Peer · Reviewer" });
    await peerRow.getByTestId("version-compare").click();
    await expect(
      page
        .getByTestId("assessment-comments")
        .getByText("Peer note", { exact: true }),
    ).toBeVisible();
    const peerResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/evaluations/${peer}/status`),
    );
    await peerRow.getByTestId("version-publish").click();
    expect((await peerResponse).status()).toBe(200);
    await expect(peerRow.getByTestId("version-status")).toHaveText("Published");
    expect(
      localSQL(
        `SELECT comment_visibility::text FROM public.evaluations WHERE id='${peer}'`,
      ),
    ).toBe("{}");
    localPermission("revoke", account.id, "ladders", workspace);
    const denied = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}/evaluations`) &&
        response.request().method() === "POST",
    );
    await page.getByTestId("level-current-Technology-4").click();
    expect((await denied).status()).toBe(403);
    await expect(page.getByTestId("evaluation-autosave")).toHaveText(
      "Could not save",
    );
    await expect(page.getByRole("alert")).toContainText(
      "The action could not be completed",
    );
    expect(
      localSQL(
        `SELECT count(*) FROM public.evaluations WHERE member_id='${member}' AND kind='manager' AND status='draft'`,
      ),
    ).toBe("0");
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE workspace_id='${workspace}';
      DELETE FROM public.members WHERE id='${member}'; DELETE FROM public.teams WHERE workspace_id='${workspace}';
      DELETE FROM public.workspaces WHERE id='${workspace}'; DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
    removeLocalAccount(account.id);
  }
});
