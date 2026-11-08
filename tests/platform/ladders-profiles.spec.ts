import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Ladders reuses member profile fields and persists scoped edits without modifying legacy tokens or evaluation history", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-ladders-profiles-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    other = randomUUID(),
    team = randomUUID(),
    member = randomUUID();
  const path = `/api/ladders/workspaces/${workspace}/members/${member}`;
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
  const input = {
    name: "Updated member",
    role: "Engineer",
    planning_role: "backend",
    template_id: "D3",
  };
  try {
    localSQL(`BEGIN; SELECT set_config('request.jwt.claim.sub','${owner}',true);
      INSERT INTO auth.users(id) VALUES('${owner}');
      INSERT INTO public.workspaces(id,owner_id,name) VALUES
      ('${workspace}','${owner}','Local Ladders profiles'),('${other}','${owner}','Other Ladders profiles');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','Profile team');
      INSERT INTO public.members(id,owner_id,team_id,name,role) VALUES('${member}','${owner}','${team}','Original member','Developer');
      INSERT INTO public.evaluations(member_id,kind,status,comments) VALUES('${member}','manager','published','{"Technology":"Keep history"}'); COMMIT;`);
    const protectedFields =
      "id,owner_id,team_id,user_id,self_token,peer_token,view_token,vacation_token,view_enabled,created_at";
    const before = localSQL(
      `SELECT row_to_json(m) FROM (SELECT ${protectedFields} FROM public.members WHERE id='${member}') m`,
    );
    const history = localSQL(
      `SELECT json_agg(e) FROM public.evaluations e WHERE member_id='${member}'`,
    );
    expect((await request.patch(path, { headers, data: input })).status()).toBe(
      403,
    );
    localPermission("grant", account.id, "ladders", workspace, "owner");
    expect(
      (
        await request.get(`/api/planner/workspaces/${workspace}/calendar`, {
          headers,
        })
      ).status(),
    ).toBe(403);
    localPermission("grant", account.id, "planner", workspace, "viewer");
    await page.goto("http://127.0.0.1:5320/ladders/");
    await page
      .getByRole("link", { name: "Local Ladders profiles", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Original member", exact: true })
      .click();
    await expect(page.getByTestId("assessment-profile")).toBeVisible();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(input.name);
    await page
      .getByRole("textbox", { name: "Role (optional)", exact: true })
      .fill(input.role);
    await page.getByTestId("assessment-planning-role").click();
    await page.getByRole("option", { name: "Backend", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Seniority template", exact: true })
      .click();
    await page.getByRole("option", { name: /D3/ }).click();
    let saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}`) &&
        response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    expect((await saved).status()).toBe(200);
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue(input.name);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue(input.name);
    await expect(page.getByTestId("assessment-planning-role")).toContainText(
      "Backend",
    );
    await expect(
      page.getByRole("combobox", { name: "Seniority template", exact: true }),
    ).toContainText("D3");
    expect(
      localSQL(
        `SELECT row_to_json(m) FROM (SELECT ${protectedFields} FROM public.members WHERE id='${member}') m`,
      ),
    ).toBe(before);
    expect(
      localSQL(
        `SELECT json_agg(e) FROM public.evaluations e WHERE member_id='${member}'`,
      ),
    ).toBe(history);
    const calendar = await (
      await request.get(`/api/planner/workspaces/${workspace}/calendar`, {
        headers,
      })
    ).json();
    expect(calendar.members).toContainEqual({
      id: member,
      team_id: team,
      name: input.name,
      role: "backend",
      can_edit: false,
    });
    localPermission("grant", account.id, "ladders", workspace, "editor");
    await page.reload();
    await page.getByTestId("assessment-planning-role").click();
    await page
      .getByRole("option", { name: "Not assigned", exact: true })
      .click();
    saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}`) &&
        response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    expect((await saved).status()).toBe(200);
    expect(
      localSQL(
        `SELECT planning_role IS NULL FROM public.members WHERE id='${member}'`,
      ),
    ).toBe("t");
    expect(
      (
        await (
          await request.get(`/api/planner/workspaces/${workspace}/calendar`, {
            headers,
          })
        ).json()
      ).members,
    ).toEqual([
      {
        id: member,
        team_id: team,
        name: input.name,
        role: null,
        can_edit: false,
      },
    ]);
    for (const data of [
      { ...input, name: " " },
      { ...input, role: "x".repeat(121) },
      { ...input, planning_role: "invalid" },
    ])
      expect((await request.patch(path, { headers, data })).status()).toBe(400);
    localPermission("grant", account.id, "ladders", other, "owner");
    expect(
      (
        await request.patch(
          `/api/ladders/workspaces/${other}/members/${member}`,
          { headers, data: input },
        )
      ).status(),
    ).toBe(404);
    await page.goto(
      `http://127.0.0.1:5320/ladders/workspaces/${other}/members/${member}`,
    );
    await expect(page.getByRole("alert")).toHaveText(
      "Member unavailable in this workspace.",
    );
    await page.goto(
      `http://127.0.0.1:5320/ladders/workspaces/${workspace}/members/${member}`,
    );
    localPermission("grant", account.id, "ladders", workspace, "viewer");
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveAttribute("readonly", "");
    await expect(
      page.getByRole("button", { name: "Save Changes", exact: true }),
    ).toHaveCount(0);
    expect((await request.patch(path, { headers, data: input })).status()).toBe(
      403,
    );
    localPermission("grant", account.id, "ladders", workspace, "editor");
    await page.reload();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Cannot save");
    localPermission("revoke", account.id, "ladders", workspace);
    saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}`) &&
        response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    expect((await saved).status()).toBe(403);
    await expect(page.getByRole("alert")).toContainText(
      "Workspace access required",
    );
    expect(
      localSQL(`SELECT name FROM public.members WHERE id='${member}'`),
    ).toBe(input.name);
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.members WHERE id='${member}';
      DELETE FROM public.teams WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}');
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
    removeLocalAccount(account.id);
  }
});
