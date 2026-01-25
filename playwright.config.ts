import { defineConfig, devices } from "@playwright/test";

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

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI 
    ? [["html", { open: "never" }], ["list"], ["github"]]
    : [["html", { open: "never" }], ["list"]],
  
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },

  /* Snapshot configuration */
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 100,
      threshold: 0.2,
    },
  },

  /* Configure projects for each app and environment */
  projects: [
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
