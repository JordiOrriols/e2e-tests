import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  api, createWorkspace, openPulse, removeWorkspace, selectWorkspace, signIn, type Account,
} from "./pulse-helpers";

const KEYS = ["health", "delivery", "autonomy", "clarity", "workload", "collaboration"];

test.describe("Pulse overview", () => {
  const contexts: BrowserContext[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  test.afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  const rpc = (account: Account, name: string, body: Record<string, unknown>) =>
    api(account, `rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  const id = (value: unknown) => String(value).replace(/"/g, "");

  async function survey(owner: Account, member: Account, workspace: string, title: string, ratings: number[][]) {
    const survey = id(await rpc(owner, "create_pulse_survey", {
      workspace, survey_title: title, questions: KEYS.map((key) => ({ key })), with_comment: false, minimum: 2,
    }));
    const questions = (await api(owner, `pulse_questions?survey_id=eq.${survey}&order=position`)) as { id: string }[];
    for (const [index, account] of [owner, member].entries())
      await rpc(account, "submit_pulse_response", {
        survey, comment: "",
        ratings: Object.fromEntries(questions.map((question, position) => [question.id, ratings[index]![position]])),
      });
    await rpc(owner, "set_pulse_survey_status", { survey, new_status: "closed" });
    return survey;
  }

  async function retro(owner: Account, workspace: string, title: string, held: string, topics: string[], until: string) {
    const retro = id(await rpc(owner, "create_pulse_retro", {
      workspace, retro_title: title, held, retro_period: null, retro_goal: "Ship calmer",
      retro_template: "well_improve", is_anonymous: true, votes: 3,
    }));
    await rpc(owner, "set_pulse_retro_stage", { retro, new_stage: "collect" });
    for (const topic of topics)
      await rpc(owner, "add_pulse_topic", { retro, topic_column: "to_improve", topic_title: topic, topic_description: null });
    for (const stage of ["group", "vote", "discuss", "actions", "closed"]) {
      await rpc(owner, "set_pulse_retro_stage", { retro, new_stage: stage });
      if (stage === until) break;
    }
    return retro;
  }

  test("a viewer sees team health, the running retro, actions and recurring problems", async ({ browser }) => {
    test.setTimeout(90_000);
    const owner = await signIn();
    const viewer = await signIn(true);
    const workspace = await createWorkspace(owner, `Pulse overview ${randomUUID().slice(0, 8)}`);
    cleanup.push(() => removeWorkspace(owner, workspace.id));
    await rpc(owner, "share_workspace", {
      workspace: workspace.id, account_email: viewer.user.email, app_name: "pulse", access: "viewer",
    });
    const people = (await rpc(owner, "pulse_workspace_people", { workspace: workspace.id })) as { user_id: string; email: string }[];
    const viewerId = people.find((person) => person.email === viewer.user.email)!.user_id;

    await survey(owner, viewer, workspace.id, "August pulse", [[4, 4, 3, 4, 3, 4], [4, 3, 4, 4, 4, 5]]);
    const latest = await survey(owner, viewer, workspace.id, "September pulse", [[4, 4, 4, 3, 2, 4], [5, 3, 4, 3, 2, 4]]);
    const first = await retro(owner, workspace.id, "Sprint 21", "2026-08-20", ["Reviews wait for days", "Scope keeps changing"], "closed");
    await retro(owner, workspace.id, "Sprint 22", "2026-09-05", ["Flaky end-to-end tests", "reviews wait for days!"], "closed");
    await retro(owner, workspace.id, "Sprint 23", "2026-09-20", ["On-call is noisy"], "closed");
    const running = await retro(owner, workspace.id, "Sprint 24", "2026-10-15", ["Flaky end-to-end tests"], "vote");
    await rpc(owner, "create_pulse_action", {
      workspace: workspace.id, retro: first, grp: null, action_title: "Rotate code reviewers weekly",
      action_description: "", action_owner: viewerId, collaborators: [], due: "2026-09-10",
      action_priority: "high", criteria: "",
    });

    const { page, context } = await openPulse(browser, viewer);
    contexts.push(context);
    await selectWorkspace(page, workspace.name);
    await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

    const health = page.getByRole("region", { name: "Team health" });
    await expect(health.getByText("From “September pulse”")).toBeVisible();
    await expect(health.getByRole("list", { name: "Latest scores" }).getByRole("listitem")).toHaveCount(6);
    const discuss = health.getByRole("list", { name: "Worth discussing" });
    await expect(discuss).toContainText("How manageable is your current workload?");
    await expect(discuss).toContainText("-1.5 since the previous survey");
    await expect(discuss).not.toContainText("How are you feeling about the team right now?");

    const current = page.getByRole("region", { name: "Current retrospective" });
    await expect(current).toContainText("Sprint 24");
    await expect(current.getByRole("img", { name: "Stage 4 of 7: Vote" })).toBeVisible();

    const actions = page.getByRole("region", { name: "Improvement actions" });
    await expect(actions.getByRole("list", { name: "Overdue" })).toContainText("Rotate code reviewers weekly");
    await expect(actions.getByText("Done since “Sprint 23”")).toBeVisible();

    await expect(page.getByRole("region", { name: "Recent retrospectives" }).getByRole("link"))
      .toHaveText(["Sprint 23", "Sprint 22", "Sprint 21"]);
    await expect(page.getByRole("region", { name: "Recurring topics" }))
      .toContainText("reviews wait for days!In Sprint 22, Sprint 21");
    await expect(page.getByRole("region", { name: "Actions that stay open" }))
      .toContainText("Rotate code reviewers weeklyOpen through 2 retrospectives");
    await expect(page.getByRole("region", { name: "Health over time" }).getByRole("img")).toHaveCount(6);

    await current.getByRole("link", { name: "Resume" }).click();
    await expect(page).toHaveURL(new RegExp(`#/retrospectives\\?retro=${running}$`));
    await expect(page.getByRole("heading", { level: 2, name: "Sprint 24" })).toBeVisible();

    await page.goBack();
    await health.getByRole("link", { name: "See results" }).click();
    await expect(page).toHaveURL(new RegExp(`#/team-pulse\\?survey=${latest}$`));
    await expect(page.getByRole("heading", { level: 2, name: "September pulse" })).toBeVisible();
  });
});
