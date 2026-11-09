import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/agents",
  timeout: 35_000,
  expect: { timeout: 25_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5189",
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
  webServer: {
    command:
      "zsh -ic 'cd ../agents && nvm use 26 >/dev/null && npm start -- --host 127.0.0.1 --port 5189 --strictPort'",
    url: "http://127.0.0.1:5189",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://agents-test.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    },
  },
});
