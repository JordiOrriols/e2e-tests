import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("one shared workspace screen creates native workspaces, invites exact accounts per app and confirms empty deletion", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const owner = await createLocalAccount(
    request,
    `local-e2e-workspace-owner-${randomUUID()}`,
  );
  const recipient = await createLocalAccount(
    request,
    `local-e2e-workspace-recipient-${randomUUID()}`,
  );
  const sameEmail = await createLocalAccount(
    request,
    `local-e2e-workspace-other-${randomUUID()}`,
  );
  let workspace: string | undefined;
  const legacyCount = localSQL("SELECT count(*) FROM auth.users");
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
  const managementURL = "http://127.0.0.1:5320/ladders/workspace-access";
  try {
    await page.setExtraHTTPHeaders(owner.headers);
    await page.goto("http://127.0.0.1:5320/ladders/");
    await page
      .getByRole("link", { name: "Workspace access", exact: true })
      .click();
    await expect(page.getByTestId("account-id")).toHaveText(owner.account.id);
    await page
      .getByRole("button", { name: "New workspace", exact: true })
      .click();
    await page.getByTestId("team-name-input").fill("Native E2E workspace");
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/workspaces") &&
        response.request().method() === "POST",
    );
    await page.getByTestId("team-name-submit").click();
    const response = await saved;
    expect(response.status()).toBe(201);
    workspace = (await response.json()).id;
    expect(localSQL("SELECT count(*) FROM auth.users")).toBe(legacyCount);
    expect(
      localSQL(
        `SELECT owner_id IS NULL FROM public.workspaces WHERE id='${workspace}'`,
      ),
    ).toBe("t");
    await expect(
      page.getByRole("region", { name: "Share ladders", exact: true }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "App", exact: true }).click();
    await page.getByRole("option", { name: "planner", exact: true }).click();
    const panel = page.getByRole("region", {
      name: "Share planner",
      exact: true,
    });
    await panel
      .getByRole("textbox", { name: "Verified account ID", exact: true })
      .fill(recipient.account.id);
    await panel
      .getByRole("combobox", { name: "Permission", exact: true })
      .click();
    await page.getByRole("option", { name: "External", exact: true }).click();
    await panel
      .getByRole("button", { name: "Invite account", exact: true })
      .click();
    await expect(
      panel.getByText("External - Invitation pending (valid for 30 days).", {
        exact: true,
      }),
    ).toBeVisible();
    const [invite] = await (
      await request.get("/api/me/workspace-invitations", {
        headers: recipient.headers,
      })
    ).json();
    expect(invite.app).toBe("planner");
    expect(invite.role).toBe("external");
    expect(
      (
        await request.post(
          `/api/me/workspace-invitations/${invite.id}/accept`,
          { headers: sameEmail.headers },
        )
      ).status(),
    ).toBe(404);
    await page.setExtraHTTPHeaders(recipient.headers);
    await page.goto(managementURL);
    await page
      .getByTestId(`workspace-invite-${invite.id}`)
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(page.getByTestId(`workspace-invite-${invite.id}`)).toHaveCount(
      0,
    );
    expect(
      (
        await request.post(
          `/api/me/workspace-invitations/${invite.id}/accept`,
          { headers: recipient.headers },
        )
      ).status(),
    ).toBe(404);
    await page.goto("http://127.0.0.1:5320/planner/");
    await page
      .getByRole("link", { name: "Native E2E workspace", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/workspaces/${workspace}/roadmap$`),
    );
    await expect(
      page.getByRole("link", { name: "Estimation", exact: true }),
    ).toHaveCount(0);
    await page    .getByRole("link", { name: "Workspace access", exact: true }).click();
    await expect(page).toHaveURL(managementURL);
    await expect(page.getByTestId("account-id")).toHaveText(
      recipient.account.id,
    );
    expect(
      await (
        await request.get("/api/apps/ladders/workspaces", {
          headers: recipient.headers,
        })
      ).json(),
    ).toEqual([]);
    await page.setExtraHTTPHeaders(owner.headers);
    await page.goto("http://127.0.0.1:5320/shiplog/");
    await page    .getByRole("link", { name: "Workspace access", exact: true }).click();
    await expect(page).toHaveURL(managementURL);
    await page.goto(managementURL);
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Native E2E workspace", exact: true })
      .click();
    await page.getByRole("combobox", { name: "App", exact: true }).click();
    await page.getByRole("option", { name: "planner", exact: true }).click();
    const grant = panel.getByTestId(`workspace-grant-${recipient.account.id}`);
    await grant.getByRole("combobox").click();
    await page.getByRole("option", { name: "Editor", exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get("/api/apps/planner/workspaces", {
                headers: recipient.headers,
              })
            ).json()
          )[0].role,
      )
      .toBe("editor");
    await grant
      .getByRole("button", {
        name: `Remove ${recipient.account.id}`,
        exact: true,
      })
      .click();
    await expect(grant).toHaveCount(0);
    const teamResponse = await request.post(
      `/api/ladders/workspaces/${workspace}/teams`,
      { headers: owner.headers, data: { name: "Native team" } },
    );
    expect(teamResponse.status()).toBe(201);
    const team = (await teamResponse.json()).teams[0].id;
    const memberResponse = await request.post(
      `/api/ladders/workspaces/${workspace}/teams/${team}/members`,
      {
        headers: owner.headers,
        data: {
          name: "Native employee",
          role: "",
          planning_role: null,
          template_id: null,
        },
      },
    );
    expect(memberResponse.status()).toBe(201);
    const member = (await memberResponse.json()).id;
    expect(
      (
        await request.delete(`/api/workspaces/${workspace}`, {
          headers: owner.headers,
        })
      ).status(),
    ).toBe(409);
    await page
      .getByRole("button", { name: "Delete workspace", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect(
      localSQL(
        `SELECT count(*) FROM public.workspaces WHERE id='${workspace}'`,
      ),
    ).toBe("1");
    expect(
      (
        await request.delete(
          `/api/ladders/workspaces/${workspace}/members/${member}`,
          { headers: owner.headers },
        )
      ).status(),
    ).toBe(200);
    await page
      .getByRole("button", { name: "Delete workspace", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete workspace", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Share planner", exact: true }),
    ).toHaveCount(0);
    expect(
      localSQL(
        `SELECT count(*) FROM public.workspaces WHERE id='${workspace}'`,
      ),
    ).toBe("0");
    expect(
      localSQL(
        `SELECT count(*) FROM platform.grants WHERE workspace_id='${workspace}'`,
      ),
    ).toBe("0");
  } finally {
    if (workspace)
      localSQL(`BEGIN;
      DELETE FROM platform.workspace_invitations WHERE workspace_id='${workspace}';
      DELETE FROM public.members WHERE team_id IN (SELECT id FROM public.teams WHERE workspace_id='${workspace}');
      UPDATE public.workspaces SET created_for_team=false WHERE id='${workspace}';
      DELETE FROM public.teams WHERE workspace_id='${workspace}';
      DELETE FROM platform.grants WHERE workspace_id='${workspace}';
      DELETE FROM public.workspaces WHERE id='${workspace}'; COMMIT;`);
    removeLocalAccount(owner.account.id);
    removeLocalAccount(recipient.account.id);
    removeLocalAccount(sameEmail.account.id);
  }
});
