import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  api, createWorkspace, openPulse, removeWorkspace, selectWorkspace, signIn, type Account,
} from "./pulse-helpers";

const HEALTH = "How are you feeling about the team right now?";
const COMMENT = "What is the main thing helping or hurting the team right now?";

test.describe("Pulse Team Pulse surveys", () => {
  const contexts: BrowserContext[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  test.afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  async function teamWorkspace(owner: Account, member?: Account) {
    const workspace = await createWorkspace(owner, `Pulse ${randomUUID().slice(0, 8)}`);
    cleanup.push(() => removeWorkspace(owner, workspace.id));
    if (member) {
      await api(owner, "rpc/share_workspace", {
        method: "POST",
        body: JSON.stringify({ workspace: workspace.id, account_email: member.user.email, app_name: "pulse", access: "viewer" }),
      });
    }
    return workspace;
  }

  async function openTeamPulse(browser: Parameters<typeof openPulse>[0], account: Account, workspace: string) {
    const { page, context } = await openPulse(browser, account);
    contexts.push(context);
    await selectWorkspace(page, workspace);
    await page.getByRole("navigation", { name: "Pulse pages" }).getByRole("link", { name: "Team Pulse" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Team Pulse" })).toBeVisible();
    return page;
  }

  /** Creates a survey with only the team health question and the comment. */
  async function createSurvey(page: Page, title: string, minimum: number) {
    await page.getByRole("button", { name: "New survey" }).click();
    const dialog = page.getByRole("dialog", { name: "New survey" });
    await dialog.getByLabel("Title").fill(title);
    for (const name of [
      "How confident are you that we can deliver our current commitments?",
      "Do you have enough autonomy to do your work effectively?",
      "Are our priorities and expectations clear?",
      "How manageable is your current workload?",
      "How well are we collaborating and supporting each other?",
    ]) await dialog.getByRole("checkbox", { name }).uncheck();
    await dialog.getByLabel("Minimum responses").fill(String(minimum));
    await dialog.getByRole("button", { name: "Create survey" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  }

  async function answer(page: Page, rating: number, comment: string) {
    await page.getByRole("button", { name: "Answer", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(`${rating} for: ${HEALTH}`).check({ force: true });
    await dialog.getByLabel(COMMENT).fill(comment);
    await dialog.getByRole("button", { name: "Send answer" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("You answered")).toBeVisible();
  }

  test("two accounts answer once each and see only aggregated results after closing", async ({ browser }) => {
    const owner = await signIn();
    const member = await signIn(true);
    const workspace = await teamWorkspace(owner, member);
    const title = `Sprint ${randomUUID().slice(0, 4)}`;

    const ownerPage = await openTeamPulse(browser, owner, workspace.name);
    await createSurvey(ownerPage, title, 2);
    await expect(ownerPage.getByText("0 of 2 answered").first()).toBeVisible();
    await answer(ownerPage, 4, "Pairing helps");

    const memberPage = await openTeamPulse(browser, member, workspace.name);
    await expect(memberPage.getByRole("button", { name: "New survey" })).toHaveCount(0);
    await expect(memberPage.getByRole("button", { name: "Close survey" })).toHaveCount(0);
    await expect(memberPage.getByText(/Results appear when the survey is closed/)).toBeVisible();
    await answer(memberPage, 2, "Too many meetings");

    const [survey] = (await api<{ id: string }[]>(owner, `pulse_surveys?workspace_id=eq.${workspace.id}&select=id`))!;
    const question = (await api<{ id: string }[]>(member, `pulse_questions?survey_id=eq.${survey!.id}&select=id`))![0]!;
    await expect(api(member, "rpc/submit_pulse_response", {
      method: "POST",
      body: JSON.stringify({ survey: survey!.id, ratings: { [question.id]: 5 }, comment: "" }),
    })).rejects.toThrow("You already answered this survey");
    for (const table of ["pulse_responses", "pulse_answers", "pulse_comments"]) {
      await expect(api(owner, `${table}?select=*`)).rejects.toThrow("permission denied");
    }

    await ownerPage.reload();
    await expect(ownerPage.getByText("2 of 2 answered").first()).toBeVisible({ timeout: 15_000 });
    await ownerPage.getByRole("button", { name: "Close survey" }).click();
    await expect(ownerPage.getByText("Closed", { exact: true })).toBeVisible();
    await expect(ownerPage.getByText("3.0", { exact: true })).toBeVisible();
    await expect(ownerPage.getByRole("img", { name: `Ratings 1 to 5 for ${HEALTH}: 0 / 1 / 0 / 1 / 0` })).toBeVisible();
    await expect(ownerPage.getByText("Pairing helps")).toBeVisible();
    await expect(ownerPage.getByText("Too many meetings")).toBeVisible();

    await memberPage.reload();
    await expect(memberPage.getByText("Too many meetings")).toBeVisible({ timeout: 15_000 });
    await expect(memberPage.getByText("3.0", { exact: true })).toBeVisible();
  });

  test("keeps results hidden while open and below the minimum after closing", async ({ browser }) => {
    const owner = await signIn();
    const workspace = await teamWorkspace(owner);
    const page = await openTeamPulse(browser, owner, workspace.name);
    await createSurvey(page, "Quiet sprint", 3);
    await answer(page, 5, "Only me");
    await page.getByRole("button", { name: "Close survey" }).click();
    await expect(page.getByText(/Only 1 answers were received and this survey needs 3/)).toBeVisible();
    await expect(page.getByText("Only me")).toHaveCount(0);

    const [result] = (await api<{ visible: boolean; distribution: object; comments: unknown[] }[]>(
      owner, "rpc/pulse_survey_results", { method: "POST", body: JSON.stringify({ workspace: workspace.id }) },
    ))!;
    expect(result).toMatchObject({ visible: false, distribution: {}, comments: [] });

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Delete survey?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No surveys yet")).toBeVisible();
  });
});
