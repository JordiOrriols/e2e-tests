import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createLocalAccount,
  localPermission,
  localSQL,
  removeLocalAccount,
} from "./local-helpers";

test("Planner separates internal views, switches scoped workspaces and rejects unknown routes", async ({
  page,
  request,
}) => {
  const { headers, account } = await createLocalAccount(
    request,
    `local-e2e-navigation-${randomUUID()}`,
  );
  const owner = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  const origin = "http://127.0.0.1:5320";
  const requests: string[] = [];
  await page.setExtraHTTPHeaders(headers);
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error(`Unexpected nonlocal browser request: ${url.hostname}`);
    requests.push(url.pathname);
    await route.continue();
  });
  try {
    localSQL(`BEGIN; INSERT INTO auth.users(id) VALUES('${owner}');
      INSERT INTO public.workspaces(id,owner_id,name,plan_start_date) VALUES
      ('${first}','${owner}','Navigation internal','2026-02-02'),
      ('${second}','${owner}','Navigation external','2026-02-02'); COMMIT;`);
    localPermission("grant", account.id, "planner", first, "viewer");
    localPermission("grant", account.id, "planner", second, "external");
    await page.goto(`${origin}/planner/workspaces/${first}/roadmap`);
    await expect(
      page.getByRole("region", { name: "Official plan", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Feature estimation", exact: true }),
    ).toHaveCount(0);
    expect(
      requests.some(
        (path) => path.endsWith("/features") || path.endsWith("/projects"),
      ),
    ).toBe(false);
    await page.getByRole("link", { name: "Estimation", exact: true }).click();
    await expect(page).toHaveURL(
      `${origin}/planner/workspaces/${first}/estimation`,
    );
    await expect(
      page.getByRole("heading", { name: "Feature estimation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Official plan", exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Feature estimation", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Team configuration", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Team configuration", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Navigation external", exact: true })
      .click();
    await expect(page).toHaveURL(
      `${origin}/planner/workspaces/${second}/roadmap`,
    );
    await expect(
      page.getByRole("link", { name: "Estimation", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Team configuration", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Official plan", exact: true }),
    ).toBeVisible();
    requests.length = 0;
    await page.goto(`${origin}/planner/workspaces/${second}/estimation`);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Feature estimation", exact: true }),
    ).toHaveCount(0);
    expect(
      requests.some(
        (path) => path.endsWith("/features") || path.endsWith("/projects"),
      ),
    ).toBe(false);
    await page.getByRole("link", { name: "Workspace", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${origin}/planner/?$`));
    await expect(
      page.getByRole("link", { name: "Navigation internal", exact: true }),
    ).toBeVisible();
    await page.goto(`${origin}/planner/not-a-real-route`);
    await expect(page.getByRole("alert")).toContainText(
      "This link is not valid",
    );
    await page.getByRole("link", { name: "Go to home", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${origin}/planner/?$`));
    expect(new URL(page.url()).hash).toBe("");
  } finally {
    removeLocalAccount(account.id);
    localSQL(`BEGIN; DELETE FROM public.workspaces WHERE id IN ('${first}','${second}');
      DELETE FROM auth.users WHERE id='${owner}'; COMMIT;`);
  }
});
