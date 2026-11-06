import { expect, test, type Page } from "@playwright/test";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "runner-test@example.com",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-11-01T00:00:00Z",
};

const history = JSON.stringify({
  kind: "agents-run",
  version: 1,
  model: "ollama/qwen3.6:35b",
  selection: "Consulta factual: modelo general.",
  answer: "No he podido verificar las atracciones abiertas hoy.",
  verification: "Un sitemap no responde a la pregunta.",
  failure: "Objetivo no conseguido",
  phases: [
    { name: "routing", seconds: 2, tokens: 80, tools: [] },
    { name: "plan", seconds: 3, tokens: 100, tools: [] },
    {
      name: "work",
      seconds: 5,
      tokens: 250,
      tools: ["webfetch: completed", "bash: error"],
    },
    { name: "review", seconds: 2, tokens: 90, tools: [] },
  ],
});

async function mockTask(page: Page, initiallyRunning = false) {
  const state = { running: initiallyRunning };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token =
    [
      { alg: "HS256", typ: "JWT" },
      {
        sub: user.id,
        exp: expires,
        aud: "authenticated",
        role: "authenticated",
      },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
      .join(".") + ".test";
  await page.addInitScript(
    ({ user, token, expires }) => {
      localStorage.setItem("i18nextLng", "es");
      localStorage.setItem(
        "sb-agents-test-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "test-refresh",
          token_type: "bearer",
          expires_at: expires,
          expires_in: 3600,
          user,
        }),
      );
    },
    { user, token, expires },
  );
  await page.route("https://agents-test.supabase.co/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === "/auth/v1/user") data = user;
    else if (path.endsWith("/list_workspaces"))
      data = [
        {
          id: "ws-1",
          name: "Test workspace",
          owner_id: user.id,
          access_level: "owner",
        },
      ];
    else if (path.endsWith("/agents_runner_status")) data = [];
    else if (path.endsWith("/agent_tasks"))
      data = [
        {
          id: "task-1",
          workspace_id: "ws-1",
          title: "Atracciones abiertas",
          instructions: "Cuántas atracciones están abiertas hoy.",
          status: state.running ? "running" : "failed",
          plan: "",
          outcome: "",
          error: "",
          seconds_spent: 12,
          tokens_generated: 100,
          tokens_total: 520,
          largest_context: 1000,
          attempts: 1,
          model: "ollama/qwen3.6:35b",
          session_id: "ses_test",
          runner: state.running ? "test-runner" : null,
          created_at: "2026-11-01T00:00:00Z",
          queued_at: "2026-11-01T00:00:00Z",
          started_at: "2026-11-01T00:00:00Z",
          finished_at: state.running ? null : "2026-11-01T00:01:00Z",
        },
      ];
    else if (path.endsWith("/agent_task_messages"))
      data = state.running
        ? []
        : [
            {
              id: "run-1",
              task_id: "task-1",
              role: "agent",
              body: history,
              created_at: "2026-11-01T00:01:00Z",
            },
          ];
    else {
      await route.fulfill({
        status: 500,
        json: { message: `Unexpected test request: ${path}` },
      });
      return;
    }
    await route.fulfill({ json: data });
  });
  return state;
}

test("shows model choice, tool states and failed verification in the conversation", async ({
  page,
}) => {
  await mockTask(page);
  await page.goto("/#/tasks/task-1");
  const run = page.getByTestId("agent-run-history");
  await expect(run).toContainText("No he podido verificar");
  await run.getByText("Historial de ejecución").click();
  await expect(run).toContainText("ollama/qwen3.6:35b");
  await expect(run).toContainText("Selección del modelo");
  await expect(run).toContainText("webfetch");
  await expect(run).toContainText("bash");
  await expect(run.getByRole("alert")).toContainText("Objetivo no conseguido");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(run).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("refreshes conversation when the runner finishes a task", async ({
  page,
}) => {
  const state = await mockTask(page, true);
  await page.goto("/#/tasks/task-1");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("agent-run-history")).toHaveCount(0);
  state.running = false;
  await expect(page.getByTestId("agent-run-history")).toContainText(
    "No he podido verificar",
  );
});
