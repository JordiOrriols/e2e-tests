import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("exact verified recipients accept or decline member invitations without legacy accounts or directory grants", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const manager = await createLocalAccount(
    request,
    `local-e2e-invite-manager-${randomUUID()}`,
  );
  const recipient = await createLocalAccount(
    request,
    `local-e2e-invite-recipient-${randomUUID()}`,
  );
  const sameEmail = await createLocalAccount(
    request,
    `local-e2e-invite-other-${randomUUID()}`,
  );
  const owner = randomUUID(),
    workspace = randomUUID(),
    team = randomUUID(),
    member = randomUUID();
  const base = `/api/ladders/workspaces/${workspace}/members/${member}`;
  const managerURL = `http://127.0.0.1:5320/ladders/workspaces/${workspace}/members/${member}`;
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
      INSERT INTO public.workspaces(id,owner_id,name) VALUES('${workspace}','${owner}','Invitation workspace');
      INSERT INTO public.teams(id,owner_id,workspace_id,name) VALUES('${team}','${owner}','${workspace}','Invitation team');
      INSERT INTO public.members(id,team_id,name) VALUES('${member}','${team}','Invited employee'); COMMIT;`);
    localPermission(
      "grant",
      manager.account.id,
      "ladders",
      workspace,
      "editor",
    );
    await page.setExtraHTTPHeaders(recipient.headers);
    await page.goto("http://127.0.0.1:5320/ladders/");
    await page
      .getByRole("link", { name: "Member invitations", exact: true })
      .click();
    await expect(page.getByTestId("account-id")).toHaveText(
      recipient.account.id,
    );
    await expect(
      page.getByText("No pending member invitations.", { exact: true }),
    ).toBeVisible();
    await page.setExtraHTTPHeaders(manager.headers);
    await page.goto(managerURL);
    const panel = page.getByRole("region", {
      name: "Member invitations",
      exact: true,
    });
    await panel
      .getByRole("textbox", { name: "Verified account ID", exact: true })
      .fill(recipient.account.id);
    await panel
      .getByRole("button", { name: "Invite member account", exact: true })
      .click();
    await expect(panel.getByRole("status")).toContainText("Invitation pending");
    const [invite] = await (
      await request.get("/api/ladders/me/member-invitations", {
        headers: recipient.headers,
      })
    ).json();
    expect(
      (
        await request.post(
          `/api/ladders/me/member-invitations/${invite.id}/accept`,
          { headers: sameEmail.headers },
        )
      ).status(),
    ).toBe(404);
    expect(
      await (
        await request.get("/api/ladders/me/member-invitations", {
          headers: sameEmail.headers,
        })
      ).json(),
    ).toEqual([]);
    await panel
      .getByRole("button", { name: "Revoke invitation", exact: true })
      .click();
    await expect(panel.getByRole("status")).toHaveCount(0);
    expect(
      (
        await request.post(
          `/api/ladders/me/member-invitations/${invite.id}/accept`,
          { headers: recipient.headers },
        )
      ).status(),
    ).toBe(404);
    await panel
      .getByRole("textbox", { name: "Verified account ID", exact: true })
      .fill(recipient.account.id);
    await panel
      .getByRole("button", { name: "Invite member account", exact: true })
      .click();
    await expect(panel.getByRole("status")).toBeVisible();
    await page.setExtraHTTPHeaders(recipient.headers);
    await page.goto("http://127.0.0.1:5320/ladders/me/invitations");
    await page
      .getByRole("button", { name: "Decline invitation", exact: true })
      .click();
    await expect(
      page.getByText("No pending member invitations.", { exact: true }),
    ).toBeVisible();
    expect(
      await (
        await request.get("/api/ladders/me/members", {
          headers: recipient.headers,
        })
      ).json(),
    ).toEqual([]);
    expect(
      (
        await request.post(
          `${base}/invitations/recipients/${recipient.account.id}`,
          { headers: manager.headers },
        )
      ).status(),
    ).toBe(201);
    await page.reload();
    await page
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/me/members/${member}/evaluations$`),
    );
    await expect(
      page.getByRole("heading", {
        name: "My evaluations - Invited employee",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await request.get(`${base}/evaluations`, { headers: recipient.headers })
      ).status(),
    ).toBe(403);
    expect(
      (await request.get("/api/me", { headers: recipient.headers })).ok(),
    ).toBe(true);
    expect(
      (
        await (
          await request.get("/api/me", { headers: recipient.headers })
        ).json()
      ).grants,
    ).toEqual([]);
    await page
      .getByRole("link", { name: "Self Assessment", exact: true })
      .click();
    await page.getByTestId("level-current-Technology-4").click();
    await expect
      .poll(() =>
        Number(
          localSQL(
            `SELECT count(*) FROM public.evaluations WHERE member_id='${member}' AND kind='self' AND status='draft'`,
          ),
        ),
      )
      .toBe(1);
    expect(
      localSQL(
        `SELECT user_id IS NULL FROM public.members WHERE id='${member}'`,
      ),
    ).toBe("t");
    expect(
      localSQL(
        `SELECT count(*) FROM platform.legacy_account_mappings WHERE user_id='${recipient.account.id}'`,
      ),
    ).toBe("0");
    await page.setExtraHTTPHeaders(manager.headers);
    await page.goto(managerURL);
    await panel
      .getByRole("button", { name: "Unlink member account", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Unlink member account", exact: true })
      .click();
    await expect(
      panel.getByRole("textbox", { name: "Verified account ID", exact: true }),
    ).toBeVisible();
    expect(
      await (
        await request.get("/api/ladders/me/members", {
          headers: recipient.headers,
        })
      ).json(),
    ).toEqual([]);
    expect(
      (
        await request.get(
          `/api/ladders/me/members/${member}/self-evaluations`,
          { headers: recipient.headers },
        )
      ).status(),
    ).toBe(404);
    expect(
      localSQL(
        `SELECT count(*) FROM public.evaluations WHERE member_id='${member}'`,
      ),
    ).toBe("1");
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE workspace_id='${workspace}';
      DELETE FROM public.evaluations WHERE member_id='${member}';
      DELETE FROM public.members WHERE id='${member}';
      DELETE FROM public.teams WHERE id='${team}';
      DELETE FROM public.workspaces WHERE id='${workspace}';
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
    removeLocalAccount(manager.account.id);
    removeLocalAccount(recipient.account.id);
    removeLocalAccount(sameEmail.account.id);
  }
});
