import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Planner vacation ranges and sprint calibration persist through the API with scoped read-only access", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-calendar-${randomUUID()}`,
  );
  const [owner, workspace, other, team, otherTeam, member, stranger] =
    Array.from({ length: 7 }, () => randomUUID());
  const path = `/api/planner/workspaces/${workspace}`;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error(`Unexpected nonlocal request: ${url.hostname}`);
    await route.continue();
  });
  await page.clock.install({ time: new Date("2026-03-02T10:00:00Z") });
  await page.setExtraHTTPHeaders(headers);
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  try {
    localSQL(`BEGIN;
      SELECT set_config('request.jwt.claim.sub','${owner}',true);
      INSERT INTO auth.users(id) VALUES('${owner}');
      INSERT INTO public.workspaces(id,owner_id,name,plan_start_date,sprint_start_date) VALUES
        ('${workspace}','${owner}','Local calendar E2E','2026-02-02','2026-02-02'),
        ('${other}','${owner}','Other private calendar','2026-02-02','2026-02-02');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES
        ('${team}','${owner}','${workspace}','Local calendar team'),
        ('${otherTeam}','${owner}','${other}','Other calendar team');
      INSERT INTO public.members(id,owner_id,team_id,name,planning_role) VALUES
        ('${member}','${owner}','${team}','Local calendar developer','backend'),
        ('${stranger}','${owner}','${otherTeam}','Private other developer','design');
      COMMIT;`);
    expect((await request.get(`${path}/calendar`, { headers })).status()).toBe(
      403,
    );
    localPermission("grant", account.id, "planner", workspace, "external");
    expect((await request.get(`${path}/calendar`, { headers })).status()).toBe(
      403,
    );
    expect((await request.get(`${path}/roadmap`, { headers })).status()).toBe(
      200,
    );
    localPermission("grant", account.id, "planner", workspace, "owner");
    const data = await (
      await request.get(`${path}/calendar`, { headers })
    ).json();
    expect(data.members).toEqual([
      {
        id: member,
        team_id: team,
        name: "Local calendar developer",
        role: "backend",
        can_edit: true,
      },
    ]);
    expect(
      (
        await request.get(`/api/planner/workspaces/${other}/calendar`, {
          headers,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.post(`${path}/members/${stranger}/vacations`, {
          headers,
          data: { start: "2026-03-02", end: "2026-03-04", working: false },
        })
      ).status(),
    ).toBe(404);
    for (const invalid of [
      { start: "2026-02-30", end: "2026-03-04", working: false },
      { start: "2026-01-01", end: "2027-01-02", working: false },
      { start: "2028-03-02", end: "2028-03-04", working: false },
      { start: "2026-03-02", end: "2026-03-04", working: "false" },
    ])
      expect(
        (
          await request.post(`${path}/members/${member}/vacations`, {
            headers,
            data: invalid,
          })
        ).status(),
      ).toBe(400);
    await page.goto(
      `http://127.0.0.1:5320/planner/workspaces/${workspace}/roadmap`,
    );
    await page
      .getByRole("link", { name: "Team Vacations", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/planner/workspaces/${workspace}/vacations$`),
    );
    await expect(
      page.getByTitle("Local calendar developer", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Show calendar", exact: true })
      .click();
    await page.getByRole("button", { name: "2026-03-02", exact: true }).click();
    await page.getByRole("button", { name: "2026-03-04", exact: true }).click();
    const write = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}/vacations`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Vacations", exact: true }).click();
    expect((await write).status()).toBe(201);
    const rows = localSQL(
      `SELECT date::text FROM public.vacations WHERE member_id='${member}' ORDER BY date`,
    );
    expect(rows).toBe("2026-03-02\n2026-03-03\n2026-03-04");
    await page.reload();
    await page
      .getByRole("button", { name: "Show calendar", exact: true })
      .click();
    await expect(
      page
        .getByRole("button", { name: "2026-03-02", exact: true })
        .getByLabel("Local calendar developer: vacation", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "2026-03-03", exact: true }).click();
    const restore = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/members/${member}/vacations`) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Working Day", exact: true })
      .click();
    expect((await restore).status()).toBe(201);
    expect(
      localSQL(
        `SELECT date::text FROM public.vacations WHERE member_id='${member}' ORDER BY date`,
      ),
    ).toBe("2026-03-02\n2026-03-04");
    await page
      .getByRole("button", { name: "Calibrate velocity", exact: true })
      .click();
    const modal = page.getByRole("dialog", {
      name: "Calibrate squad velocity",
    });
    await modal
      .getByRole("button", { name: "Add sprint", exact: true })
      .click();
    await modal
      .getByRole("textbox", { name: "Sprint start", exact: true })
      .fill("2026-02-02");
    await modal
      .getByRole("spinbutton", { name: "Delivered story points", exact: true })
      .fill("12.5");
    const calibrate = page.waitForResponse(
      (response) =>
        response.url().endsWith("/calibration") &&
        response.request().method() === "PATCH",
    );
    await modal
      .getByRole("button", { name: "Save calibration", exact: true })
      .click();
    expect((await calibrate).status()).toBe(200);
    await expect(modal).not.toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Calibrate velocity", exact: true })
      .click();
    await expect(
      modal.getByRole("spinbutton", {
        name: "Delivered story points",
        exact: true,
      }),
    ).toHaveValue("12.5");
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      (
        await request.patch(`${path}/calibration`, {
          headers,
          data: {
            anchor: "2026-02-02",
            history: [{ start_date: "2026-02-03", story_points: 1 }],
          },
        })
      ).status(),
    ).toBe(400);
    localPermission("grant", account.id, "planner", workspace, "viewer");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Calibrate velocity", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Show calendar", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "2026-03-02", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Vacations", exact: true }),
    ).toBeDisabled();
    expect(
      (
        await request.post(`${path}/members/${member}/vacations`, {
          headers,
          data: { start: "2026-03-02", end: "2026-03-04", working: true },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.patch(`${path}/calibration`, {
          headers,
          data: { anchor: "2026-02-02", history: [] },
        })
      ).status(),
    ).toBe(403);
    localPermission("revoke", account.id, "planner", workspace);
    expect((await request.get(`${path}/calendar`, { headers })).status()).toBe(
      403,
    );
  } finally {
    removeLocalAccount(account.id);
    localSQL(`BEGIN;
      DELETE FROM public.vacations WHERE member_id IN ('${member}','${stranger}');
      DELETE FROM public.members WHERE id IN ('${member}','${stranger}');
      DELETE FROM public.teams WHERE id IN ('${team}','${otherTeam}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}');
      DELETE FROM auth.users WHERE id='${owner}';
      COMMIT;`);
  }
});
