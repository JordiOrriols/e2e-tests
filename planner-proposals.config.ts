import { defineConfig, devices } from "@playwright/test";
import { localApps } from "./project-navigation.config";

export default defineConfig({
  testDir: "./tests/planner",
  testMatch: "priority-proposals.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  ...localApps(["planner"]),
});
