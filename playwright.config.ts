import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * Project configuration for all environments
 */
const projectConfigs = {
  website: {
    localhost: "http://localhost:5173",
    production: "https://www.jordiorriols.cat",
  },
  airmap: {
    localhost: "http://localhost:5174",
    production: "https://airmap.jordiorriols.cat",
  },
  ladders: {
    localhost: "http://localhost:5175",
    production: "https://ladders.jordiorriols.cat",
  },
} as const;

export type ProjectName = keyof typeof projectConfigs;
export type Environment = "localhost" | "production";

export { projectConfigs };

/**
 * Signed-in session for the ladders app, written by scripts/ladders-auth.ts.
 *
 * Ladders hides everything behind an EntryGate until a user is signed in, so
 * without this the suite can only ever see the welcome screen. The path is
 * referenced unconditionally because globalSetup writes the file before any
 * browser context is created; probing for it here would drop the session on the
 * very first run of a clean checkout.
 */
const laddersStorageState = resolve(
  import.meta.dirname,
  "auth/ladders-storage-state.json",
);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["list"], ["github"]]
    : [["html", { open: "never" }], ["list"]],

  globalSetup: resolve(import.meta.dirname, "scripts/ladders-auth.ts"),

  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
  },

  /*
   * Snapshot configuration
   *
   * The ladders UI is already rendered by the time we assert, so every check
   * resolves in a few milliseconds. Five seconds is generous for that and, more
   * importantly, keeps a genuinely broken interaction from stalling the run for
   * the better part of a minute.
   */
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      maxDiffPixels: 100,
      threshold: 0.2,
    },
  },

  /* Configure projects for each app and environment */
  projects: [
    {
      name: "planner-localhost",
      testDir: "./tests/planner",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5176",
      },
      metadata: { project: "planner", environment: "localhost" },
    },
    // Website
    {
      name: "website-localhost",
      testDir: "./tests/website",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: projectConfigs.website.localhost,
      },
      metadata: {
        project: "website",
        environment: "localhost",
      },
    },
    {
      name: "website-production",
      testDir: "./tests/website",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: projectConfigs.website.production,
      },
      metadata: {
        project: "website",
        environment: "production",
      },
    },

    // Airmap
    {
      name: "airmap-localhost",
      testDir: "./tests/airmap",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: projectConfigs.airmap.localhost,
      },
      metadata: {
        project: "airmap",
        environment: "localhost",
      },
    },
    {
      name: "airmap-production",
      testDir: "./tests/airmap",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: projectConfigs.airmap.production,
      },
      metadata: {
        project: "airmap",
        environment: "production",
      },
    },

    // Ladders
    {
      name: "ladders-localhost",
      testDir: "./tests/ladders",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: projectConfigs.ladders.localhost,
        storageState: laddersStorageState,
      },
      metadata: {
        project: "ladders",
        environment: "localhost",
      },
    },
    {
      name: "ladders-production",
      testDir: "./tests/ladders",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: projectConfigs.ladders.production,
      },
      metadata: {
        project: "ladders",
        environment: "production",
      },
    },

    // Mobile variants
    {
      name: "website-mobile",
      testDir: "./tests/website",
      use: {
        ...devices["iPhone 14"],
        baseURL: projectConfigs.website.production,
      },
      metadata: {
        project: "website",
        environment: "production",
        device: "mobile",
      },
    },
    {
      name: "airmap-mobile",
      testDir: "./tests/airmap",
      use: {
        ...devices["iPhone 14"],
        baseURL: projectConfigs.airmap.production,
      },
      metadata: {
        project: "airmap",
        environment: "production",
        device: "mobile",
      },
    },
    {
      name: "ladders-mobile",
      testDir: "./tests/ladders",
      use: {
        ...devices["iPhone 14"],
        baseURL: projectConfigs.ladders.production,
      },
      metadata: {
        project: "ladders",
        environment: "production",
        device: "mobile",
      },
    },
  ],
});
