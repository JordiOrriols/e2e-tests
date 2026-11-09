import { defineConfig, devices } from "@playwright/test";
import { localApps } from "./project-navigation.config";

export default defineConfig({
  testDir: "./tests/shared",
  testMatch: ["workspace-lifecycle.spec.ts", "agents-navigation.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  ...localApps(["ladders", "planner", "pulse", "shiplog", "agents"]),
});
