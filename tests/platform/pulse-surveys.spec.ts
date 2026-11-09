import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Pulse reuses survey forms with verified access, anonymous threshold results and no legacy authentication", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const owner = await createLocalAccount(
    request,
    `local-e2e-pulse-owner-${randomUUID()}`,
  );
  const viewer = await createLocalAccount(
    request,
    `local-e2e-pulse-viewer-${randomUUID()}`,
  );
  const other = await createLocalAccount(
    request,
    `local-e2e-pulse-other-${randomUUID()}`,
  );
  let workspace: string | undefined;
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
    const created = await request.post("/api/workspaces", {
      headers: owner.headers,
      data: { name: "Pulse E2E team" },
    });
    expect(created.status()).toBe(201);
    const workspaceId: string = (await created.json()).id;
    workspace = workspaceId;
    localPermission("grant", viewer.account.id, "pulse", workspaceId, "viewer");
    const url = `http://127.0.0.1:5320/pulse/workspaces/${workspace}/surveys`;
    await page.setExtraHTTPHeaders(owner.headers);
    await page.goto("http://127.0.0.1:5320/pulse/");
    await expect(
      page.getByRole("link", { name: "Workspace access", exact: true }),
    ).toHaveAttribute("href", "/ladders/workspace-access");
    await page
      .getByRole("link", { name: "Pulse E2E team", exact: true })
      .click();
    await expect(page).toHaveURL(url);
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "New survey", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "New survey",
      exact: true,
    });
    await dialog
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("API team health");
    await dialog
      .getByRole("spinbutton", { name: "Minimum responses", exact: true })
      .fill("2");
    await dialog
      .getByRole("button", { name: "Create survey", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "API team health", exact: true }),
    ).toBeVisible();
    const [survey] = await (
      await request.get(`/api/pulse/workspaces/${workspace}/surveys`, {
        headers: owner.headers,
      })
    ).json();
    expect(survey.pulse_questions).toHaveLength(6);
    const ratings = Object.fromEntries(
      survey.pulse_questions.map((question: { id: string }) => [
        question.id,
        4,
      ]),
    );
    expect(
      (
        await request.get(`/api/pulse/workspaces/${workspace}/surveys`, {
          headers: other.headers,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.post(`/api/pulse/workspaces/${workspace}/surveys`, {
          headers: viewer.headers,
          data: {},
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post(`/api/pulse/workspaces/${workspace}/surveys`, {
          headers: viewer.headers,
          data: {
            title: "Not allowed",
            asks_comment: true,
            min_responses: 2,
            questions: [{ key: "health" }],
          },
        })
      ).status(),
    ).toBe(403);
    const answer = async (comment: string) => {
      await page.getByRole("button", { name: "Answer", exact: true }).click();
      const form = page.getByRole("dialog", {
        name: "API team health",
        exact: true,
      });
      for (const radio of await form
        .getByRole("radio", { name: /^4 for:/ })
        .all())
        await radio.press("Space");
      await form.getByRole("textbox").fill(comment);
      await form
        .getByRole("button", { name: "Send answer", exact: true })
        .click();
      await expect(form).toHaveCount(0);
      await expect(
        page.getByText("You answered", { exact: true }),
      ).toBeVisible();
    };
    await answer("Manager comment");
    await page
      .getByRole("button", { name: "Close survey", exact: true })
      .click();
    await expect(
      page.getByText(
        "Only 1 answers were received and this survey needs 2 to show results, so they stay hidden to protect anonymity.",
        { exact: true },
      ),
    ).toBeVisible();
    const resultsPath = `/api/pulse/workspaces/${workspace}/survey-results`;
    let [result] = await (
      await request.get(resultsPath, { headers: viewer.headers })
    ).json();
    expect(result).toMatchObject({
      responses: 1,
      participants: 2,
      visible: false,
      distribution: {},
      comments: [],
    });
    await page.getByRole("button", { name: "Reopen", exact: true }).click();
    await page.setExtraHTTPHeaders(viewer.headers);
    await page.goto(url);
    await expect(
      page.getByRole("button", { name: "New survey", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toHaveCount(0);
    await answer("Participant comment");
    expect(
      (
        await request.post(
          `/api/pulse/workspaces/${workspace}/surveys/${survey.id}/responses`,
          {
            headers: viewer.headers,
            data: { ratings, comment: "Duplicate" },
          },
        )
      ).status(),
    ).toBe(409);
    [result] = await (
      await request.get(resultsPath, { headers: viewer.headers })
    ).json();
    expect(result).toMatchObject({
      responses: 2,
      visible: false,
      distribution: {},
      comments: [],
    });
    await page.setExtraHTTPHeaders(owner.headers);
    await page.goto(url);
    await page
      .getByRole("button", { name: "Close survey", exact: true })
      .click();
    await expect(
      page.getByText("Participant comment", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Manager comment", { exact: true }),
    ).toBeVisible();
    [result] = await (
      await request.get(resultsPath, { headers: viewer.headers })
    ).json();
    expect(result.visible).toBe(true);
    expect(Object.values(result.distribution)).toEqual(
      Array.from({ length: 6 }, () => [0, 0, 0, 2, 0]),
    );
    expect(JSON.stringify(result)).not.toContain(viewer.account.id);
    await page.reload();
    await expect(
      page.getByText("Participant comment", { exact: true }),
    ).toBeVisible();
    await page.setExtraHTTPHeaders(viewer.headers);
    localPermission("revoke", viewer.account.id, "pulse", workspaceId);
    await page.goto(url);
    await expect(
      page.getByText(
        "You do not have access to this workspace. Ask the sender to share it with your account.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.setExtraHTTPHeaders(owner.headers);
    await page.goto(url);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Delete survey?",
      exact: true,
    });
    await confirmation
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "API team health", exact: true }),
    ).toHaveCount(0);
    expect(
      localSQL(
        `SELECT count(*) FROM platform.pulse_participations p JOIN public.pulse_surveys s ON s.id=p.survey_id WHERE s.workspace_id='${workspace}'`,
      ),
    ).toBe("0");
    await page
      .getByRole("link", { name: "Workspace access", exact: true })
      .click();
    await expect(page.getByTestId("account-id")).toHaveText(owner.account.id);
  } finally {
    if (workspace)
      localSQL(`BEGIN; DELETE FROM public.pulse_surveys WHERE workspace_id='${workspace}';
      DELETE FROM platform.grants WHERE workspace_id='${workspace}'; DELETE FROM public.workspaces WHERE id='${workspace}'; COMMIT;`);
    for (const account of [owner, viewer, other])
      removeLocalAccount(account.account.id);
  }
});
