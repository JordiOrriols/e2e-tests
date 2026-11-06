import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apps = ["ladders", "planner", "pulse", "shiplog"] as const;
const root =
  process.env.APP_NAVIGATION_ROOT ?? resolve(import.meta.dirname, "..");
const canonicalRoot = resolve(import.meta.dirname, "..");

export default defineConfig({
  testDir: "./tests/shared",
  testMatch: "agents-navigation.spec.ts",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  ...localApps(apps),
});

export function localApps(apps: readonly string[]) {
  return {
    projects: apps.map((app, index) => ({
      name: app,
      use: { baseURL: `http://127.0.0.1:${5191 + index}` },
      metadata: { app },
    })),
    webServer: apps.map((app, index) => {
      const directory = resolve(root, app);
      const env = Object.fromEntries(
        readFileSync(resolve(canonicalRoot, app, ".env"), "utf8")
          .split("\n")
          .map((line) => line.match(/^\s*(VITE_SUPABASE_\w+)\s*=\s*(.*?)\s*$/))
          .filter((match): match is RegExpMatchArray => !!match)
          .map((match) => [match[1], match[2].replace(/^["']|["']$/g, "")]),
      );
      return {
        command: `zsh -ic 'nvm use 26 >/dev/null; npm start -- --host 127.0.0.1 --port ${5191 + index} --strictPort'`,
        cwd: directory,
        url: `http://127.0.0.1:${5191 + index}`,
        reuseExistingServer: false,
        env,
      };
    }),
  };
}
