import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

const apiDirectory = resolve(
  import.meta.dirname,
  "../../../backend-access-local/api",
);
export function localSQL(sql: string): string {
  return execFileSync(
    "docker",
    [
      "--context",
      "desktop-linux",
      "compose",
      "--env-file",
      ".env",
      "-f",
      "compose.local.yml",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-d",
      "platform",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-c",
      sql,
    ],
    { cwd: apiDirectory, encoding: "utf8" },
  ).trim();
}
export function localPermission(...args: string[]): void {
  execFileSync(
    "docker",
    [
      "--context",
      "desktop-linux",
      "compose",
      "--env-file",
      ".env",
      "-f",
      "compose.local.yml",
      "run",
      "--rm",
      "--no-deps",
      "permissions",
      ...args,
    ],
    { cwd: apiDirectory, encoding: "utf8", stdio: "pipe" },
  );
}
export async function createLocalAccount(
  request: APIRequestContext,
  sub: string,
) {
  const issued = await request.post("http://127.0.0.1:5301/test-token", {
    data: { sub, email: "platform-e2e@example.com" },
  });
  expect(issued.ok()).toBe(true);
  const { token } = await issued.json();
  const headers = { "Cf-Access-Jwt-Assertion": token };
  const response = await request.get("/api/me", { headers });
  expect(response.status()).toBe(200);
  const account = await response.json();
  expect(account.id).toMatch(/^[0-9a-f-]{36}$/);
  return { headers, account };
}
export function removeLocalAccount(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid test account ID");
  localSQL(`BEGIN; DELETE FROM platform.grants WHERE user_id='${id}';
    DELETE FROM platform.planner_priority_proposals WHERE created_by='${id}';
    DELETE FROM platform.identities WHERE user_id='${id}';
    DELETE FROM platform.users WHERE id='${id}'; COMMIT;`);
}
