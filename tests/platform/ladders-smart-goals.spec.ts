import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Ladders SMART goals reuse the member panel with viewer, editor and owner permissions", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-ladders-smart-goals-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    team = randomUUID(),
    member = randomUUID(),
    goal = randomUUID();
  const base = `/api/ladders/workspaces/${workspace}/members/${member}/goals`;
  const url = `http://127.0.0.1:5320/ladders/workspaces/${workspace}/members/${member}`;
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','SMART goals');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','Growth team');
      INSERT INTO public.members(id,team_id,name) VALUES('${member}','${team}','Growth member');
      INSERT INTO public.smart_goals(id,member_id,title,description,due_date,progress,comments,created_at,updated_at)
      VALUES('${goal}','${member}','Existing goal','Existing description','2026-12-01',20,
        '[{"id":"${randomUUID()}","text":"Legacy note","createdAt":"2026-10-01T00:00:00Z","authorKind":"legacy"}]',
        '2026-10-01','2026-10-02'); COMMIT;`);

    expect((await request.get(base, { headers })).status()).toBe(403);
    localPermission("grant", account.id, "ladders", workspace, "viewer");
    await page.goto(url);
    const viewerGoal = page
      .getByTestId("goal-read")
      .filter({ hasText: "Existing goal" });
    await expect(viewerGoal).toBeVisible();
    await expect(page.getByTestId("goal-create-form")).toHaveCount(0);
    await expect(viewerGoal.getByTestId("goal-progress")).toHaveCount(0);
    await expect(
      viewerGoal.getByRole("button", { name: "Delete goal" }),
    ).toHaveCount(0);
    expect(
      (
        await request.post(base, {
          headers,
          data: {
            title: "Not allowed",
            description: "",
            due_date: null,
            progress: 0,
          },
        })
      ).status(),
    ).toBe(403);

    localPermission("grant", account.id, "ladders", workspace, "editor");
    await page.reload();
    await expect(page.getByTestId("goal-create-form")).toBeVisible();
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}/goals`) &&
        response.request().method() === "POST",
    );
    await page.getByTestId("goal-title-input").fill("Career growth");
    await page
      .getByTestId("goal-description-input")
      .fill("Lead a cross-team initiative");
    await page.getByTestId("goal-date-input").fill("2026-12-15");
    await page.getByTestId("goal-create-submit").click();
    const createdResponse = await createResponse;
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json();
    const createdId = created.id as string;
    expect(created.title).toBe("Career growth");
    const card = page.locator(
      `[data-testid="goal"][data-goal-id="${createdId}"]`,
    );
    await expect(card).toBeVisible();

    await card.getByTestId("goal-title-field").fill("Career growth plan");
    await card
      .getByTestId("goal-description-field")
      .fill("Deliver the initiative and share results");
    await card.getByTestId("goal-date-field").fill("2027-01-15");
    const progress = card.getByTestId("goal-progress");
    await progress.focus();
    await progress.press("End");
    for (let step = 0; step < 7; step++) await progress.press("ArrowLeft");
    await expect(card.getByTestId("goal-progress-value")).toHaveText("65%");
    const updateResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/goals/${createdId}`) &&
        response.request().method() === "PATCH",
    );
    await card.getByTestId("goal-save").click();
    expect((await updateResponse).status()).toBe(200);

    await card.getByTestId("goal-comment-input").fill("Manager progress note");
    const commentResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/goals/${createdId}/comments`) &&
        response.request().method() === "POST",
    );
    await card.getByTestId("goal-comment-submit").click();
    expect((await commentResponse).status()).toBe(201);
    await expect(card.getByText("Manager progress note")).toBeVisible();
    expect(
      (await request.delete(`${base}/${createdId}`, { headers })).status(),
    ).toBe(403);

    localPermission("grant", account.id, "ladders", workspace, "owner");
    await page.reload();
    const ownerCard = page.locator(
      `[data-testid="goal"][data-goal-id="${createdId}"]`,
    );
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/goals/${createdId}`) &&
        response.request().method() === "DELETE",
    );
    await ownerCard.getByRole("button", { name: "Delete goal" }).click();
    expect((await deleteResponse).status()).toBe(200);
    await expect(ownerCard).toHaveCount(0);
    expect(
      localSQL(
        `SELECT count(*) FROM public.smart_goals WHERE id='${createdId}'`,
      ),
    ).toBe("0");

    localPermission("revoke", account.id, "ladders", workspace);
    expect((await request.get(base, { headers })).status()).toBe(403);
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE workspace_id='${workspace}';
      DELETE FROM public.members WHERE id='${member}'; DELETE FROM public.teams WHERE workspace_id='${workspace}';
      DELETE FROM public.workspaces WHERE id='${workspace}'; DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
    removeLocalAccount(account.id);
  }
});
