import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./tests/platform",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15_000,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:5300" },
  webServer: process.env["PLATFORM_DOCKER_WEB"] === "1" ? undefined : {
    command: "npm start",
    cwd: resolve(import.meta.dirname, "../shiplog-access-local"),
    url: "http://127.0.0.1:5318/shiplog/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
