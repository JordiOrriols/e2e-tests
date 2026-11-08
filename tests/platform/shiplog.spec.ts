import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

import { localSQL, createLocalAccount } from "./local-helpers";
const origin =
  process.env["PLATFORM_DOCKER_WEB"] === "1"
    ? "http://127.0.0.1:5320"
    : "http://127.0.0.1:5318";

test("Access-authenticated catalog uses path routes, respects grants and never calls Supabase", async ({
  page,
  request,
}) => {
  const sub = `local-e2e-${randomUUID()}`;
  const { headers, account } = await createLocalAccount(request, sub);
  const source: {
    workspace: string;
    name: string;
    release: string;
    title: string;
  } = JSON.parse(
    localSQL(`SELECT json_build_object('workspace',r.workspace_id,'name',w.name,
      'release',r.id,'title',r.title) FROM public.shiplog_releases r
      JOIN public.workspaces w ON w.id=r.workspace_id LIMIT 1`),
  );
  expect(source.workspace).toMatch(/^[0-9a-f-]{36}$/);
  const requests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error(`Unexpected nonlocal browser request: ${url.hostname}`);
    await route.continue();
  });
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await page.setExtraHTTPHeaders(headers);
  try {
    await page.goto(`${origin}/shiplog/`);
    await expect(page.getByRole("status")).toContainText("do not have access");
    const forbidden = await request.get(
      `/api/shiplog/workspaces/${source.workspace}/catalog`,
      { headers },
    );
    expect(forbidden.status()).toBe(403);
    localSQL(`INSERT INTO platform.grants(user_id,app,workspace_id,role)
      VALUES('${account.id}','shiplog','${source.workspace}','external')`);
    await page.reload();
    await page.getByRole("link", { name: source.name, exact: true }).click();
    await expect(page).toHaveURL(
      `${origin}/shiplog/workspaces/${source.workspace}/releases`,
    );
    await expect(
      page.getByRole("heading", { name: source.name, exact: true }),
    ).toBeVisible();
    const detail = `${origin}/shiplog/workspaces/${source.workspace}/releases/${source.release}`;
    await page.goto(detail);
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("heading", { level: 2 })).toContainText(
      source.title,
    );
    expect(new URL(page.url()).hash).toBe("");
    expect(
      requests.some(
        (url) => url.includes("supabase") || url.includes("/auth/"),
      ),
    ).toBe(false);
    localSQL(`DELETE FROM platform.grants WHERE user_id='${account.id}'`);
    await page.reload();
    await expect(page.getByRole("alert")).toContainText(
      "Workspace access required",
    );
    await page.setExtraHTTPHeaders({});
    await page.goto(`${origin}/shiplog/`);
    await expect(page.getByRole("alert")).toContainText(
      "Cloudflare Access token required",
    );
    await expect(page.getByRole("button", { name: /sign in/i })).toHaveCount(0);
  } finally {
    localSQL(`BEGIN; DELETE FROM platform.grants WHERE user_id='${account.id}';
      DELETE FROM platform.identities WHERE user_id='${account.id}';
      DELETE FROM platform.users WHERE id='${account.id}'; COMMIT;`);
  }
});
