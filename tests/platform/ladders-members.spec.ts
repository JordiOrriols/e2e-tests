import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Ladders creates members with reused profile fields, explicit edit grants and no account or token exposure", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-ladders-members-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    other = randomUUID(),
    team = randomUUID(),
    foreign = randomUUID();
  const path = `/api/ladders/workspaces/${workspace}/teams/${team}/members`;
  const input = {
    name: "Created member",
    role: "Engineer",
    planning_role: null,
    template_id: null,
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
    localSQL(`BEGIN; INSERT INTO auth.users(id) VALUES('${owner}');
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Local member creation'),('${other}','${owner}','Other member creation');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','Creation team'),('${foreign}','${owner}','${other}','Foreign team'); COMMIT;`);
    expect((await request.post(path, { headers, data: input })).status()).toBe(
      403,
    );
    localPermission("grant", account.id, "ladders", workspace, "viewer");
    await page.goto(
      `http://127.0.0.1:5320/ladders/workspaces/${workspace}/teams`,
    );
    await expect(
      page.getByRole("link", {
        name: "Add member to Creation team",
        exact: true,
      }),
    ).toHaveCount(0);
    expect((await request.post(path, { headers, data: input })).status()).toBe(
      403,
    );
    localPermission("grant", account.id, "ladders", workspace, "editor");
    await page.reload();
    await page
      .getByRole("link", { name: "Add member to Creation team", exact: true })
      .click();
    await expect(page.getByTestId("assessment-profile")).toBeVisible();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(input.name);
    await page
      .getByRole("textbox", { name: "Role (optional)", exact: true })
      .fill(input.role);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/teams/${team}/members`) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const result = await response.json();
    expect(Object.keys(result)).toEqual(["id"]);
    await expect(page).toHaveURL(
      `http://127.0.0.1:5320/ladders/workspaces/${workspace}/members/${result.id}`,
    );
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue(input.name);
    expect(
      localSQL(
        `SELECT user_id IS NULL AND NOT view_enabled AND owner_id='${owner}' FROM public.members WHERE id='${result.id}'`,
      ),
    ).toBe("t");
    await page.getByRole("link", { name: "Teams", exact: true }).click();
    await expect(
      page.getByRole("link", { name: input.name, exact: true }),
    ).toBeVisible();
    expect(
      (
        await request.post(
          `/api/ladders/workspaces/${workspace}/teams/${foreign}/members`,
          { headers, data: input },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post(path, { headers, data: { ...input, name: "" } })
      ).status(),
    ).toBe(400);
    await page
      .getByRole("link", { name: "Add member to Creation team", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Revoked member");
    localPermission("revoke", account.id, "ladders", workspace);
    const denied = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/teams/${team}/members`) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    expect((await denied).status()).toBe(403);
    await expect(page.getByRole("alert")).toContainText(
      "Workspace access required",
    );
    expect(
      localSQL(`SELECT count(*) FROM public.members WHERE team_id='${team}'`),
    ).toBe("1");
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.members WHERE team_id IN ('${team}','${foreign}');
      DELETE FROM public.teams WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}'); DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
    removeLocalAccount(account.id);
  }
});
