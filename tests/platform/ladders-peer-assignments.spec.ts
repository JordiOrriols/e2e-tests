import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("managers assign verified peers who submit one private review without directory access or anonymous links", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const manager = await createLocalAccount(
    request,
    `local-e2e-peer-manager-${randomUUID()}`,
  );
  const reviewer = await createLocalAccount(
    request,
    `local-e2e-peer-reviewer-${randomUUID()}`,
  );
  const owner = randomUUID(),
    reviewerLegacy = randomUUID(),
    workspace = randomUUID(),
    team = randomUUID(),
    member = randomUUID(),
    reviewerMember = randomUUID();
  const base = `/api/ladders/workspaces/${workspace}/members/${member}`;
  const content = {
    current_levels: { Technology: 4 },
    goal_levels: {},
    comments: { Technology: "Submitted peer note" },
  };
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
      INSERT INTO auth.users(id) VALUES('${owner}'),('${reviewerLegacy}');
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Peer workspace');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','Peer team');
      INSERT INTO public.members(id,team_id,name) VALUES('${member}','${team}','Target employee'),('${reviewerMember}','${team}','Verified colleague');
      SELECT set_config('members.claiming','${member}',true);
      UPDATE public.members SET user_id='${owner}' WHERE id='${member}';
      SELECT set_config('members.claiming','${reviewerMember}',true);
      UPDATE public.members SET user_id='${reviewerLegacy}' WHERE id='${reviewerMember}'; COMMIT;`);
    localPermission("map-legacy", manager.account.id, owner);
    localPermission("map-legacy", reviewer.account.id, reviewerLegacy);
    localPermission(
      "grant",
      manager.account.id,
      "ladders",
      workspace,
      "viewer",
    );
    expect(
      (
        await request.get(`${base}/peer-candidates`, {
          headers: manager.headers,
        })
      ).status(),
    ).toBe(403);
    localPermission(
      "grant",
      manager.account.id,
      "ladders",
      workspace,
      "editor",
    );
    expect(
      (
        await request.get(`${base}/peer-candidates`, {
          headers: reviewer.headers,
        })
      ).status(),
    ).toBe(403);
    await page.setExtraHTTPHeaders(manager.headers);
    const managerURL = `http://127.0.0.1:5320/ladders/workspaces/${workspace}/members/${member}/evaluations`;
    await page.goto(managerURL);
    const panel = page.getByRole("region", {
      name: "Peer reviews",
      exact: true,
    });
    await panel
      .getByRole("combobox", { name: "Reviewer", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Verified colleague", exact: true })
      .click();
    const assigned = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/peer-assignments/reviewers/${reviewerMember}`) &&
        response.request().method() === "POST",
    );
    await panel
      .getByRole("button", { name: "Assign peer review", exact: true })
      .click();
    expect((await assigned).status()).toBe(201);
    const assignments = await (
      await request.get(`${base}/peer-assignments`, {
        headers: manager.headers,
      })
    ).json();
    const assignment = assignments[0].id;
    await expect(
      panel.getByTestId(`peer-assignment-${assignment}`),
    ).toContainText("Pending");
    expect(
      (
        await request.post(
          `${base}/peer-assignments/reviewers/${reviewerMember}`,
          { headers: manager.headers },
        )
      ).status(),
    ).toBe(409);
    expect(
      (await request.get("/api/ladders/me/peer-assignments")).status(),
    ).toBe(401);
    expect(
      await (
        await request.get("/api/ladders/me/peer-assignments", {
          headers: manager.headers,
        })
      ).json(),
    ).toEqual([]);
    await page.setExtraHTTPHeaders(reviewer.headers);
    await page.goto("http://127.0.0.1:5320/ladders/");
    await page.getByRole("link", { name: "Peer reviews", exact: true }).click();
    await page
      .getByRole("link", { name: "Target employee", exact: true })
      .click();
    await expect(page.getByTestId("assessment-competencies")).toBeVisible();
    await expect(page.getByTestId("version-panel")).toHaveCount(0);
    await expect(page.getByTestId("level-goal-Technology-4")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("assessment-competencies")).toBeVisible();
    await page.getByTestId("level-current-Technology-4").click();
    const submitted = page.waitForResponse((response) =>
      response.url().endsWith(`/peer-assignments/${assignment}/submit`),
    );
    await page.getByTestId("peer-evaluation-publish").click();
    const submission = await submitted;
    expect(submission.status()).toBe(201);
    const evaluation = await submission.json();
    expect(evaluation.kind).toBe("peer");
    expect(evaluation.status).toBe("draft");
    expect(evaluation.author_name).toBe("Verified colleague");
    expect(evaluation.comment_visibility).toEqual({});
    await expect(page.getByRole("status")).toContainText(
      "Your evaluation has been sent",
    );
    expect(
      (
        await request.post(
          `/api/ladders/me/peer-assignments/${assignment}/submit`,
          { headers: reviewer.headers, data: content },
        )
      ).status(),
    ).toBe(409);
    expect(
      (
        await request.get(`${base}/evaluations`, { headers: reviewer.headers })
      ).status(),
    ).toBe(403);
    const employeeHistory = await (
      await request.get(`/api/ladders/me/members/${member}/evaluations`, {
        headers: manager.headers,
      })
    ).json();
    expect(employeeHistory.evaluations).toHaveLength(0);
    await page.setExtraHTTPHeaders(manager.headers);
    await page.goto(managerURL);
    const peerRow = page
      .getByTestId("version-row")
      .filter({ hasText: "Peer · Verified colleague" });
    await expect(peerRow).toBeVisible();
    await peerRow.getByTestId("version-publish").click();
    await expect(peerRow.getByTestId("version-status")).toHaveText("Published");
    const next = await request.post(
      `${base}/peer-assignments/reviewers/${reviewerMember}`,
      { headers: manager.headers },
    );
    expect(next.status()).toBe(201);
    const second = (await next.json()).find(
      (row: { id: string }) => row.id !== assignment,
    ).id;
    await page.reload();
    const revoked = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/peer-assignments/${second}`) &&
        response.request().method() === "DELETE",
    );
    await page
      .getByTestId(`peer-assignment-${second}`)
      .getByRole("button", { name: "Revoke assignment" })
      .click();
    expect((await revoked).status()).toBe(200);
    expect(
      (
        await request.post(
          `/api/ladders/me/peer-assignments/${second}/submit`,
          { headers: reviewer.headers, data: content },
        )
      ).status(),
    ).toBe(404);
    expect(
      localSQL(
        `SELECT count(*) FROM public.evaluations WHERE member_id='${member}'`,
      ),
    ).toBe("1");
    expect(
      localSQL(
        `SELECT status FROM public.evaluations WHERE id='${evaluation.id}'`,
      ),
    ).toBe("published");
  } finally {
    localSQL(`BEGIN;
      DELETE FROM platform.legacy_account_mappings WHERE legacy_user_id IN ('${owner}','${reviewerLegacy}');
      DELETE FROM platform.grants WHERE workspace_id='${workspace}';
      DELETE FROM public.members WHERE team_id='${team}';
      DELETE FROM public.teams WHERE id='${team}';
      DELETE FROM public.workspaces WHERE id='${workspace}';
      DELETE FROM auth.users WHERE id IN ('${owner}','${reviewerLegacy}'); COMMIT;`);
    removeLocalAccount(manager.account.id);
    removeLocalAccount(reviewer.account.id);
  }
});
