import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Ladders reuses evaluation history with scoped versions, comparisons and private self-draft exclusion", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-ladders-history-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    other = randomUUID(),
    team = randomUUID(),
    foreignTeam = randomUUID();
  const member = randomUUID(),
    foreignMember = randomUUID(),
    manager = randomUUID(),
    peer = randomUUID(),
    self = randomUUID(),
    privateSelf = randomUUID();
  const path = `/api/ladders/workspaces/${workspace}/members/${member}/evaluations`;
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Local history'),('${other}','${owner}','Foreign history');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','History team'),('${foreignTeam}','${owner}','${other}','Foreign history team');
      INSERT INTO public.members(id,team_id,name) VALUES('${member}','${team}','History member'),('${foreignMember}','${foreignTeam}','Foreign member');
      INSERT INTO public.evaluations(id,member_id,kind,status,author_name,current_levels,comments,created_at) VALUES
      ('${manager}','${member}','manager','published',null,'{"Technology":3}','{"Technology":"Manager history comment"}','2026-10-01'),
      ('${peer}','${member}','peer','draft','Reviewer','{"Technology":4}','{"Technology":"Unapproved peer history comment"}','2026-10-02'),
      ('${self}','${member}','self','published',null,'{"Technology":2}','{"Technology":"Published self history comment"}','2026-10-03'),
      ('${privateSelf}','${member}','self','draft',null,'{}','{"Technology":"Private self history draft"}','2026-10-04'); COMMIT;`);
    const before = localSQL(
      `SELECT jsonb_agg(to_jsonb(e) ORDER BY id)::text FROM public.evaluations e WHERE member_id='${member}'`,
    );
    expect((await request.get(path, { headers })).status()).toBe(403);
    localPermission("grant", account.id, "ladders", workspace, "viewer");
    await page.goto(
      `http://127.0.0.1:5320/ladders/workspaces/${workspace}/members/${member}`,
    );
    await page.getByRole("link", { name: "Versions", exact: true }).click();
    await expect(page.getByTestId("evaluation-viewer")).toBeVisible();
    await expect(page.getByTestId("version-row")).toHaveCount(3);
    await expect(
      page.getByText("Manager history comment", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Published self history comment", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Private self history draft", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("version-delete")).toHaveCount(0);
    await expect(page.getByTestId("version-publish")).toHaveCount(0);
    const result = await (await request.get(path, { headers })).json();
    expect(result.map((row: { id: string }) => row.id)).toEqual([
      self,
      peer,
      manager,
    ]);
    expect(JSON.stringify(result)).not.toContain("Private self history draft");
    const peerRow = page
      .getByTestId("version-row")
      .filter({ hasText: "Peer · Reviewer" });
    await peerRow
      .getByRole("button", { name: "Show on chart", exact: true })
      .click();
    await expect(
      page.getByText("Unapproved peer history comment", { exact: true }),
    ).toBeVisible();
    await peerRow.getByRole("button").first().click();
    await expect(peerRow.getByRole("button").first()).toHaveAttribute(
      "aria-current",
      "true",
    );
    await page.reload();
    await expect(page.getByTestId("version-row")).toHaveCount(3);
    await expect(
      page.getByRole("heading", {
        name: "Versions - History member",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Language", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByTestId("language-button-fr").click();
    await expect(
      page.getByRole("heading", { name: "Échelle d’ingénierie", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("version-row")).toHaveCount(3);
    await page.getByRole("button", { name: "Langue", exact: true }).click();
    await page.getByTestId("language-button-en").click();
    await expect(page.getByRole("contentinfo")).toContainText("Made with love");
    expect(
      (
        await request.get(
          `/api/ladders/workspaces/${workspace}/members/${foreignMember}/evaluations`,
          { headers },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get(
          `/api/ladders/workspaces/${workspace}/members/not-a-uuid/evaluations`,
          { headers },
        )
      ).status(),
    ).toBe(400);
    await page
      .getByRole("link", { name: "Member profile", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("History member");
    await page.getByRole("link", { name: "Versions", exact: true }).click();
    localPermission("revoke", account.id, "ladders", workspace);
    await page.reload();
    await expect(page.getByTestId("evaluation-viewer")).toHaveCount(0);
    await expect(
      page.getByText("You do not have permission to perform this action.", {
        exact: true,
      }),
    ).toBeVisible();
    expect((await request.get(path, { headers })).status()).toBe(403);
    expect(
      localSQL(
        `SELECT jsonb_agg(to_jsonb(e) ORDER BY id)::text FROM public.evaluations e WHERE member_id='${member}'`,
      ),
    ).toBe(before);
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.members WHERE id IN ('${member}','${foreignMember}');
      DELETE FROM public.teams WHERE workspace_id IN ('${workspace}','${other}');
      DELETE FROM public.workspaces WHERE id IN ('${workspace}','${other}');
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
    removeLocalAccount(account.id);
  }
});
