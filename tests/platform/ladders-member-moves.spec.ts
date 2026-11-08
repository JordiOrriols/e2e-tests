import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Ladders moves preserve profiles and history with explicit save, scoped edit grants and reload", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-ladders-moves-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    other = randomUUID();
  const source = randomUUID(),
    destination = randomUUID(),
    foreign = randomUUID(),
    member = randomUUID();
  const path = `/api/ladders/workspaces/${workspace}/members/${member}/teams/${destination}`;
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Local moves'),('${other}','${owner}','Foreign moves');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${source}','${owner}','${workspace}','Source team'),('${destination}','${owner}','${workspace}','Destination team'),('${foreign}','${owner}','${other}','Foreign team');
      INSERT INTO public.members(id,team_id,name,role,planning_role) VALUES('${member}','${source}','Moving member','Engineer','backend');
      INSERT INTO public.evaluations(member_id,kind,status) VALUES('${member}','manager','published');
      INSERT INTO public.smart_goals(member_id,title) VALUES('${member}','Persistent goal'); COMMIT;`);
    const before = localSQL(
      `SELECT (to_jsonb(m)-'team_id'-'updated_at')::text FROM public.members m WHERE id='${member}'`,
    );
    expect((await request.patch(path, { headers })).status()).toBe(403);
    localPermission("grant", account.id, "ladders", workspace, "viewer");
    await page.goto(
      `http://127.0.0.1:5320/ladders/workspaces/${workspace}/members/${member}`,
    );
    await expect(page.getByTestId("assessment-profile")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Move member", exact: true }),
    ).toHaveCount(0);
    expect((await request.patch(path, { headers })).status()).toBe(403);
    localPermission("grant", account.id, "ladders", workspace, "editor");
    await page.reload();
    const move = page.getByRole("button", { name: "Move member", exact: true });
    await expect(move).toBeDisabled();
    await page.getByRole("combobox", { name: "Team", exact: true }).click();
    await page
      .getByRole("option", { name: "Destination team", exact: true })
      .click();
    // Selecting a team alone must not mutate the member.
    expect(
      localSQL(`SELECT team_id FROM public.members WHERE id='${member}'`),
    ).toBe(source);
    await page.reload();
    await expect(move).toBeDisabled();
    await page.getByRole("combobox", { name: "Team", exact: true }).click();
    await page
      .getByRole("option", { name: "Destination team", exact: true })
      .click();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}/teams/${destination}`) &&
        response.request().method() === "PATCH",
    );
    await move.click();
    expect((await saved).status()).toBe(200);
    await expect(
      page.getByRole("combobox", { name: "Team", exact: true }),
    ).toContainText("Destination team");
    await expect(move).toBeDisabled();
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Moving member");
    await expect(
      page.getByRole("combobox", { name: "Team", exact: true }),
    ).toContainText("Destination team");
    expect(
      localSQL(
        `SELECT (to_jsonb(m)-'team_id'-'updated_at')::text FROM public.members m WHERE id='${member}'`,
      ),
    ).toBe(before);
    expect(
      localSQL(
        `SELECT (SELECT count(*) FROM public.evaluations WHERE member_id='${member}') || ':' || (SELECT count(*) FROM public.smart_goals WHERE member_id='${member}')`,
      ),
    ).toBe("1:1");
    await page.getByRole("link", { name: "Teams", exact: true }).click();
    const destinationSection = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Destination team",
          exact: true,
        }),
      });
    await expect(
      destinationSection.getByRole("link", {
        name: "Moving member",
        exact: true,
      }),
    ).toBeVisible();
    const sourceSection = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Source team", exact: true }),
      });
    await expect(
      sourceSection.getByRole("link", { name: "Moving member", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await request.patch(
          `/api/ladders/workspaces/${workspace}/members/${member}/teams/${foreign}`,
          { headers },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.patch(
          `/api/ladders/workspaces/${workspace}/members/${member}/teams/not-a-uuid`,
          { headers },
        )
      ).status(),
    ).toBe(400);
    await destinationSection
      .getByRole("link", { name: "Moving member", exact: true })
      .click();
    await page.getByRole("combobox", { name: "Team", exact: true }).click();
    await page
      .getByRole("option", { name: "Source team", exact: true })
      .click();
    localPermission("revoke", account.id, "ladders", workspace);
    const denied = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}/teams/${source}`) &&
        response.request().method() === "PATCH",
    );
    await move.click();
    expect((await denied).status()).toBe(403);
    await expect(page.getByRole("alert")).toContainText(
      "You do not have permission",
    );
    expect(
      localSQL(`SELECT team_id FROM public.members WHERE id='${member}'`),
    ).toBe(destination);
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.members WHERE id='${member}';
      DELETE FROM public.teams WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}');
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
    removeLocalAccount(account.id);
  }
});
