import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Ladders deletion requires confirmed ownership and protects nonempty/default teams and workspace grants", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-ladders-deletion-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    other = randomUUID(),
    team = randomUUID(),
    defaultTeam = randomUUID(),
    emptyTeam = randomUUID(),
    member = randomUUID();
  const base = `/api/ladders/workspaces/${workspace}`;
  const memberURL = `http://127.0.0.1:5320/ladders/workspaces/${workspace}/members/${member}`;
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
      INSERT INTO public.workspaces(id,owner_id,name,created_for_team) VALUES
      ('${workspace}','${owner}','Local Ladders deletion',true),('${other}','${owner}','Other Ladders deletion',false);
      INSERT INTO public.teams(id,owner_id,workspace_id,name,is_default) VALUES
      ('${team}','${owner}','${workspace}','Occupied team',false),
      ('${defaultTeam}','${owner}','${workspace}','Default team',true),
      ('${emptyTeam}','${owner}','${workspace}','Empty team',false);
      INSERT INTO public.members(id,owner_id,team_id,name) VALUES('${member}','${owner}','${team}','Delete member');
      INSERT INTO public.evaluations(member_id,kind,status) VALUES('${member}','manager','published');
      INSERT INTO public.smart_goals(member_id,title) VALUES('${member}','Delete goal');
      INSERT INTO public.vacations(member_id,date,is_working) VALUES('${member}','2026-11-09',false); COMMIT;`);
    expect(
      (await request.delete(`${base}/members/${member}`, { headers })).status(),
    ).toBe(403);
    localPermission("grant", account.id, "ladders", workspace, "editor");
    await page.goto(memberURL);
    await expect(
      page.getByRole("button", { name: "Delete Delete member", exact: true }),
    ).toHaveCount(0);
    expect(
      (await request.delete(`${base}/members/${member}`, { headers })).status(),
    ).toBe(403);
    expect(
      (
        await request.delete(`${base}/teams/${emptyTeam}`, { headers })
      ).status(),
    ).toBe(403);
    localPermission("grant", account.id, "ladders", workspace, "owner");
    localPermission("grant", account.id, "ladders", other, "owner");
    expect(
      (
        await request.delete(
          `/api/ladders/workspaces/${other}/members/${member}`,
          { headers },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.delete(
          `/api/ladders/workspaces/${other}/teams/${emptyTeam}`,
          { headers },
        )
      ).status(),
    ).toBe(404);
    expect(
      (await request.delete(`${base}/teams/${team}`, { headers })).status(),
    ).toBe(409);
    expect(
      (
        await request.delete(`${base}/teams/${defaultTeam}`, { headers })
      ).status(),
    ).toBe(409);
    await page.goto(
      `http://127.0.0.1:5320/ladders/workspaces/${workspace}/teams`,
    );
    await expect(
      page.getByRole("button", { name: "Delete Occupied team", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Delete Default team", exact: true })
      .click();
    let modal = page.getByRole("alertdialog");
    const blocked = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/teams/${defaultTeam}`) &&
        response.request().method() === "DELETE",
    );
    await modal
      .getByRole("button", { name: "Delete team", exact: true })
      .click();
    expect((await blocked).status()).toBe(409);
    await expect(modal).not.toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      "The default team cannot be deleted.",
    );
    await page.goto(memberURL);
    await page
      .getByRole("button", { name: "Delete Delete member", exact: true })
      .click();
    modal = page.getByRole("alertdialog");
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      localSQL(`SELECT count(*) FROM public.members WHERE id='${member}'`),
    ).toBe("1");
    await page
      .getByRole("button", { name: "Delete Delete member", exact: true })
      .click();
    const deleted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}`) &&
        response.request().method() === "DELETE",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    expect((await deleted).status()).toBe(200);
    await expect(page).toHaveURL(
      `http://127.0.0.1:5320/ladders/workspaces/${workspace}/teams`,
    );
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Delete member", exact: true }),
    ).toHaveCount(0);
    for (const table of ["evaluations", "smart_goals", "vacations"])
      expect(
        localSQL(
          `SELECT count(*) FROM public.${table} WHERE member_id='${member}'`,
        ),
      ).toBe("0");
    await page
      .getByRole("button", { name: "Delete Occupied team", exact: true })
      .click();
    modal = page.getByRole("alertdialog");
    const deletedTeam = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/teams/${team}`) &&
        response.request().method() === "DELETE",
    );
    await modal
      .getByRole("button", { name: "Delete team", exact: true })
      .click();
    expect((await deletedTeam).status()).toBe(200);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Occupied team", exact: true }),
    ).toHaveCount(0);
    expect(
      localSQL(
        `SELECT created_for_team FROM public.workspaces WHERE id='${workspace}'`,
      ),
    ).toBe("f");
    expect(
      (await request.get("/api/apps/ladders/workspaces", { headers })).status(),
    ).toBe(200);
    await page
      .getByRole("button", { name: "Delete Empty team", exact: true })
      .click();
    localPermission("revoke", account.id, "ladders", workspace);
    const revoked = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/teams/${emptyTeam}`) &&
        response.request().method() === "DELETE",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete team", exact: true })
      .click();
    expect((await revoked).status()).toBe(403);
    await expect(page.getByRole("alert")).toContainText(
      "You do not have permission to perform this action.",
    );
    expect(
      localSQL(`SELECT count(*) FROM public.teams WHERE id='${emptyTeam}'`),
    ).toBe("1");
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.members WHERE id='${member}';
      DELETE FROM public.teams WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}');
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
    removeLocalAccount(account.id);
  }
});
