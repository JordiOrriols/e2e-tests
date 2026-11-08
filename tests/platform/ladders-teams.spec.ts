import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Ladders authenticated team directory reuses name dialogs and enforces explicit cross-app access", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-ladders-teams-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    other = randomUUID(),
    team = randomUUID(),
    member = randomUUID();
  const path = `/api/ladders/workspaces/${workspace}/teams`;
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES
      ('${workspace}','${owner}','Local Ladders directory'),('${other}','${owner}','Other Ladders directory');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','Existing team');
      INSERT INTO public.members(id,owner_id,team_id,name,role) VALUES('${member}','${owner}','${team}','Directory member','Developer'); COMMIT;`);
    expect((await request.get(path)).status()).toBe(401);
    expect((await request.get(path, { headers })).status()).toBe(403);
    localPermission("grant", account.id, "planner", workspace, "owner");
    expect((await request.get(path, { headers })).status()).toBe(403);
    await page.goto("http://127.0.0.1:5320/ladders/");
    await expect(
      page.getByText("No Ladders workspace access.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: /password/i })).toHaveCount(
      0,
    );
    localPermission("grant", account.id, "ladders", workspace, "owner");
    await page.reload();
    await page
      .getByRole("link", { name: "Local Ladders directory", exact: true })
      .click();
    expect(new URL(page.url()).hash).toBe("");
    await expect(
      page.getByText("Directory member - Developer", { exact: true }),
    ).toBeVisible();
    const directory = await (await request.get(path, { headers })).json();
    expect(Object.keys(directory.members[0]).sort()).toEqual([
      "id",
      "name",
      "planning_role",
      "role",
      "team_id",
      "template_id",
    ]);
    await page
      .getByRole("button", { name: "Create team", exact: true })
      .click();
    let modal = page.getByRole("alertdialog");
    await modal
      .getByRole("textbox", { name: "Team name", exact: true })
      .fill("Created locally");
    const create = page.waitForResponse(
      (response) =>
        response.url().endsWith("/teams") &&
        response.request().method() === "POST",
    );
    await modal
      .getByRole("button", { name: "Create team", exact: true })
      .click();
    expect((await create).status()).toBe(201);
    await expect(modal).not.toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Created locally", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Rename Created locally", exact: true })
      .click();
    modal = page.getByRole("alertdialog");
    await modal
      .getByRole("textbox", { name: "Team name", exact: true })
      .fill("Renamed locally");
    const rename = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/teams/"),
    );
    await modal.getByRole("button", { name: "Rename", exact: true }).click();
    expect((await rename).status()).toBe(200);
    await expect(modal).not.toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Renamed locally", exact: true }),
    ).toBeVisible();
    localPermission("grant", account.id, "ladders", workspace, "editor");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Create team", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await request.post(path, { headers, data: { name: "Not owner" } })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.patch(`${path}/${team}`, { headers, data: { name: " " } })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.patch(`${path}/${team}`, {
          headers,
          data: { name: "x".repeat(121) },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.patch(`${path}/${team}`, {
          headers,
          data: { name: "Editor renamed" },
        })
      ).status(),
    ).toBe(200);
    localPermission("grant", account.id, "ladders", other, "owner");
    expect(
      (
        await request.patch(`/api/ladders/workspaces/${other}/teams/${team}`, {
          headers,
          data: { name: "Foreign write" },
        })
      ).status(),
    ).toBe(404);
    localPermission("grant", account.id, "ladders", workspace, "viewer");
    await page.reload();
    await expect(page.getByRole("button", { name: /^Rename / })).toHaveCount(0);
    expect(
      (
        await request.patch(`${path}/${team}`, {
          headers,
          data: { name: "Viewer write" },
        })
      ).status(),
    ).toBe(403);
    localPermission("revoke", account.id, "ladders", workspace);
    await page.reload();
    await expect(page.getByRole("alert")).toContainText(
      "Workspace access required",
    );
    expect((await request.get(path, { headers })).status()).toBe(403);
    await page.goto(`http://127.0.0.1:5320/ladders/e/${randomUUID()}`);
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:5320\/ladders\/?$/);
    await expect(page.getByRole("textbox", { name: /password/i })).toHaveCount(
      0,
    );
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.members WHERE id='${member}';
      DELETE FROM public.teams WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}');
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
    removeLocalAccount(account.id);
  }
});
