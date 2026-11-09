import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("linked employees update goal progress and append member comments without changing manager definitions", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const employee = await createLocalAccount(
    request,
    `local-e2e-my-goals-${randomUUID()}`,
  );
  const manager = await createLocalAccount(
    request,
    `local-e2e-my-goals-manager-${randomUUID()}`,
  );
  const legacy = randomUUID(),
    workspace = randomUUID(),
    team = randomUUID(),
    member = randomUUID(),
    otherMember = randomUUID(),
    goal = randomUUID(),
    otherGoal = randomUUID();
  const base = `/api/ladders/me/members/${member}/goals`;
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
      INSERT INTO auth.users(id) VALUES('${legacy}');
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${legacy}','Employee goals workspace');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${legacy}','${workspace}','Employee goals team');
      INSERT INTO public.members(id,team_id,name) VALUES('${member}','${team}','Goal employee'),('${otherMember}','${team}','Other employee');
      SELECT set_config('members.claiming','${member}',true);
      UPDATE public.members SET user_id='${legacy}' WHERE id='${member}';
      INSERT INTO public.smart_goals(id,member_id,title,description,due_date,progress) VALUES
      ('${goal}','${member}','Career plan','Manager-defined description','2026-12-01',10),
      ('${otherGoal}','${otherMember}','Other plan','Other definition',null,0); COMMIT;`);
    const definition = () =>
      localSQL(
        `SELECT (to_jsonb(g)-'progress'-'comments'-'updated_at')::text FROM public.smart_goals g WHERE id='${goal}'`,
      );
    const before = definition();
    expect((await request.get(base)).status()).toBe(401);
    expect(
      (await request.get(base, { headers: employee.headers })).status(),
    ).toBe(404);
    localPermission("map-legacy", employee.account.id, legacy);
    localPermission("grant", manager.account.id, "ladders", workspace, "owner");
    expect(
      (await request.get(base, { headers: manager.headers })).status(),
    ).toBe(404);
    expect(
      (
        await request.patch(`${base}/${goal}/progress`, {
          headers: manager.headers,
          data: { progress: 50 },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.patch(`${base}/${otherGoal}/progress`, {
          headers: employee.headers,
          data: { progress: 50 },
        })
      ).status(),
    ).toBe(404);
    for (const progress of [-1, 101, 2.5])
      expect(
        (
          await request.patch(`${base}/${goal}/progress`, {
            headers: employee.headers,
            data: { progress },
          })
        ).status(),
      ).toBe(400);
    await page.goto(
      `http://127.0.0.1:5320/ladders/me/members/${member}/evaluations`,
    );
    await page.getByRole("link", { name: "SMART Goals", exact: true }).click();
    const card = page.locator(
      `[data-testid="goal-read"][data-goal-id="${goal}"]`,
    );
    await expect(card).toBeVisible();
    await expect(page.getByTestId("goal-read")).toHaveCount(1);
    await expect(page.getByTestId("goal-create-form")).toHaveCount(0);
    await expect(page.getByTestId("goal-title-field")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete goal" })).toHaveCount(
      0,
    );
    await card.getByTestId("goal-progress").focus();
    await card.getByTestId("goal-progress").press("End");
    await expect(card.getByTestId("goal-progress-value")).toHaveText("100%");
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/goals/${goal}/progress`) &&
        response.request().method() === "PATCH",
    );
    await card.getByTestId("goal-progress-save").click();
    expect((await saved).status()).toBe(200);
    await card.getByTestId("goal-comment-input").fill("Employee progress note");
    const commented = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/goals/${goal}/comments`) &&
        response.request().method() === "POST",
    );
    await card.getByTestId("goal-comment-submit").click();
    expect((await commented).status()).toBe(201);
    await expect(
      card.getByText("Employee progress note", { exact: true }),
    ).toBeVisible();
    const injected = await request.patch(`${base}/${goal}/progress`, {
      headers: employee.headers,
      data: {
        progress: 75,
        title: "Spoofed title",
        member_id: otherMember,
        comments: [],
      },
    });
    expect(injected.status()).toBe(200);
    expect((await injected.json()).title).toBe("Career plan");
    const comment = await request.post(`${base}/${goal}/comments`, {
      headers: employee.headers,
      data: { text: " Second note ", authorKind: "manager", comments: [] },
    });
    expect(comment.status()).toBe(201);
    const result = await comment.json();
    expect(result.comments.map((item: { text: string }) => item.text)).toEqual([
      "Employee progress note",
      "Second note",
    ]);
    expect(
      result.comments.every(
        (item: { authorKind: string }) => item.authorKind === "member",
      ),
    ).toBe(true);
    expect(definition()).toBe(before);
    await page.reload();
    await expect(card.getByTestId("goal-progress-value")).toHaveText("75%");
    await expect(
      card.getByText("Employee progress note", { exact: true }),
    ).toBeVisible();
    localPermission("unmap-legacy", employee.account.id, legacy);
    await card.getByTestId("goal-progress").focus();
    await card.getByTestId("goal-progress").press("Home");
    const denied = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/goals/${goal}/progress`) &&
        response.request().method() === "PATCH",
    );
    await card.getByTestId("goal-progress-save").click();
    expect((await denied).status()).toBe(404);
    await expect(page.getByRole("alert")).toBeVisible();
    expect(
      (
        await request.post(`${base}/${goal}/comments`, {
          headers: employee.headers,
          data: { text: "Revoked" },
        })
      ).status(),
    ).toBe(404);
    await page.reload();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("goal-read")).toHaveCount(0);
    expect(
      localSQL(`SELECT progress FROM public.smart_goals WHERE id='${goal}'`),
    ).toBe("75");
    expect(definition()).toBe(before);
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
