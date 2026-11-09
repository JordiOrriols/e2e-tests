import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("employees autosave and publish only their own self evaluations using the shared editor", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const employee = await createLocalAccount(
    request,
    `local-e2e-self-${randomUUID()}`,
  );
  const manager = await createLocalAccount(
    request,
    `local-e2e-self-manager-${randomUUID()}`,
  );
  const legacy = randomUUID(),
    workspace = randomUUID(),
    team = randomUUID(),
    member = randomUUID(),
    foreignMember = randomUUID(),
    reviewer = randomUUID();
  const base = `/api/ladders/me/members/${member}/self-evaluations`;
  const content = {
    current_levels: { Technology: 3.5 },
    goal_levels: {},
    comments: { Technology: "Own answer" },
  };
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${legacy}','Self workspace');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${legacy}','${workspace}','Self team');
      INSERT INTO public.members(id,team_id,name) VALUES('${member}','${team}','Self employee'),('${foreignMember}','${team}','Other employee');
      SELECT set_config('members.claiming','${member}',true);
      UPDATE public.members SET user_id='${legacy}' WHERE id='${member}';
      INSERT INTO public.evaluations(id,member_id,kind,status,comments) VALUES
      ('${reviewer}','${member}','manager','published','{"Technology":"Private reviewer comment"}'); COMMIT;`);
    const reviewerBefore = localSQL(
      `SELECT to_jsonb(e)::text FROM public.evaluations e WHERE id='${reviewer}'`,
    );
    expect((await request.post(base, { data: content })).status()).toBe(401);
    expect(
      (
        await request.post(base, { headers: employee.headers, data: content })
      ).status(),
    ).toBe(404);
    localPermission("map-legacy", employee.account.id, legacy);
    localPermission("grant", manager.account.id, "ladders", workspace, "owner");
    expect(
      (
        await request.post(base, { headers: manager.headers, data: content })
      ).status(),
    ).toBe(404);
    expect(
      (await request.get(base, { headers: manager.headers })).status(),
    ).toBe(404);
    expect(
      (
        await request.post(
          `/api/ladders/me/members/${foreignMember}/self-evaluations`,
          { headers: employee.headers, data: content },
        )
      ).status(),
    ).toBe(404);
    await page.goto(
      `http://127.0.0.1:5320/ladders/me/members/${member}/evaluations`,
    );
    await page
      .getByRole("link", { name: "Self Assessment", exact: true })
      .click();
    await expect(page.getByTestId("assessment-competencies")).toBeVisible();
    await expect(page.getByTestId("level-goal-Technology-3")).toHaveCount(0);
    await expect(page.getByTestId("self-evaluation-publish")).toBeDisabled();
    await expect(page.getByTestId("version-row")).toHaveCount(0);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}/self-evaluations`) &&
        response.request().method() === "POST",
    );
    await page.getByTestId("level-current-Technology-3").click();
    const createdResponse = await saved;
    expect(createdResponse.status()).toBe(201);
    const draft = await createdResponse.json();
    expect(draft.kind).toBe("self");
    expect(draft.status).toBe("draft");
    expect(draft.author_name).toBe("Self employee");
    expect(draft.comment_visibility).toEqual({});
    await expect(page.getByTestId("evaluation-autosave")).toHaveText(
      "Draft saved",
    );
    await page.reload();
    await expect(page.getByTestId("evaluation-autosave")).toHaveText(
      "Draft saved",
    );
    const updated = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/self-evaluations/${draft.id}`) &&
        response.request().method() === "PATCH",
    );
    await page.getByTestId("level-current-Technology-4").click();
    expect((await updated).status()).toBe(200);
    await expect(page.getByTestId("evaluation-autosave")).toHaveText(
      "Draft saved",
    );
    expect(
      (
        await request.post(base, { headers: employee.headers, data: content })
      ).status(),
    ).toBe(409);
    const privateHistory = await request.get(
      `/api/ladders/workspaces/${workspace}/members/${member}/evaluations`,
      { headers: manager.headers },
    );
    expect(JSON.stringify(await privateHistory.json())).not.toContain(draft.id);
    expect(
      (
        await request.patch(`${base}/${reviewer}`, {
          headers: employee.headers,
          data: content,
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post(`${base}/${reviewer}/publish`, {
          headers: employee.headers,
        })
      ).status(),
    ).toBe(404);
    const published = page.waitForResponse((response) =>
      response.url().endsWith(`/self-evaluations/${draft.id}/publish`),
    );
    await page.getByTestId("self-evaluation-publish").click();
    expect((await published).status()).toBe(201);
    const before = localSQL(
      `SELECT to_jsonb(e)::text FROM public.evaluations e WHERE id='${draft.id}'`,
    );
    expect(
      (
        await request.patch(`${base}/${draft.id}`, {
          headers: employee.headers,
          data: content,
        })
      ).status(),
    ).toBe(409);
    expect(
      localSQL(`SELECT status FROM public.evaluations WHERE id='${draft.id}'`),
    ).toBe("published");
    const publishedHistory = await request.get(
      `/api/ladders/workspaces/${workspace}/members/${member}/evaluations`,
      { headers: manager.headers },
    );
    expect(JSON.stringify(await publishedHistory.json())).toContain(draft.id);
    await page.reload();
    await expect(page.getByTestId("self-evaluation-publish")).toBeDisabled();
    const next = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}/self-evaluations`) &&
        response.request().method() === "POST",
    );
    await page.getByTestId("level-current-Technology-2").click();
    expect((await next).status()).toBe(201);
    await expect(page.getByTestId("evaluation-autosave")).toHaveText(
      "Draft saved",
    );
    expect(
      localSQL(
        `SELECT to_jsonb(e)::text FROM public.evaluations e WHERE id='${draft.id}'`,
      ),
    ).toBe(before);
    expect(
      localSQL(
        `SELECT to_jsonb(e)::text FROM public.evaluations e WHERE id='${reviewer}'`,
      ),
    ).toBe(reviewerBefore);
    localPermission("unmap-legacy", employee.account.id, legacy);
    const denied = page.waitForResponse(
      (response) =>
        response.url().includes("/self-evaluations/") &&
        response.request().method() === "PATCH",
    );
    await page.getByTestId("level-current-Technology-5").click();
    expect((await denied).status()).toBe(404);
    await expect(page.getByTestId("evaluation-autosave")).toHaveText(
      "Could not save",
    );
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("self-evaluation-publish")).toBeDisabled();
  } finally {
    localSQL(`BEGIN;
      DELETE FROM platform.legacy_account_mappings WHERE legacy_user_id='${legacy}';
      DELETE FROM platform.grants WHERE workspace_id='${workspace}';
      DELETE FROM public.members WHERE team_id='${team}';
      DELETE FROM public.teams WHERE workspace_id='${workspace}';
      DELETE FROM public.workspaces WHERE id='${workspace}';
      DELETE FROM auth.users WHERE id='${legacy}'; COMMIT;`);
    removeLocalAccount(employee.account.id);
    removeLocalAccount(manager.account.id);
  }
});
