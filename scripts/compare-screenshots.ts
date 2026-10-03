import { chromium, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * Screenshot comparison script
 * Compares production vs localhost screenshots for each project
 */

interface ProjectConfig {
  name: string;
  localhost: string;
  production: string;
  pages: string[];
}

const projects: ProjectConfig[] = [
  {
    name: "website",
    localhost: "http://localhost:5173",
    production: "https://www.jordiorriols.cat",
    pages: ["/"],
  },
  {
    name: "airmap",
    localhost: "http://localhost:5174",
    production: "https://airmap.jordiorriols.cat",
    pages: ["/", "/planner"],
  },
  {
    name: "ladders",
    localhost: "http://localhost:5175",
    production: "https://ladders.jordiorriols.cat",
    pages: ["/"],
  },
];

const SCREENSHOT_DIR = "./screenshots/comparison";
const VIEWPORT = { width: 1280, height: 720 };

async function takeScreenshot(
  page: Page,
  url: string,
  name: string,
): Promise<string> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);

  const filename = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filename, fullPage: true });

  return filename;
}

async function compare(): Promise<void> {
  // Ensure screenshot directory exists
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  const results: {
    project: string;
    page: string;
    production: string;
    localhost: string;
    status: "success" | "localhost-unavailable" | "production-unavailable";
  }[] = [];

  for (const project of projects) {
    console.log(`\n📸 Processing ${project.name}...`);

    for (const pagePath of project.pages) {
      const safePath = pagePath.replace(/\//g, "_") || "home";
      const baseName = `${project.name}${safePath}`;

      // Take production screenshot
      let productionFile = "";
      try {
        console.log(
          `  → Taking production screenshot: ${project.production}${pagePath}`,
        );
        productionFile = await takeScreenshot(
          page,
          `${project.production}${pagePath}`,
          `${baseName}-production`,
        );
        console.log(`    ✓ Saved: ${productionFile}`);
      } catch (error) {
        console.log(`    ✗ Production unavailable`);
        results.push({
          project: project.name,
          page: pagePath,
          production: "",
          localhost: "",
          status: "production-unavailable",
        });
        continue;
      }

      // Take localhost screenshot
      let localhostFile = "";
      try {
        console.log(
          `  → Taking localhost screenshot: ${project.localhost}${pagePath}`,
        );
        localhostFile = await takeScreenshot(
          page,
          `${project.localhost}${pagePath}`,
          `${baseName}-localhost`,
        );
        console.log(`    ✓ Saved: ${localhostFile}`);
      } catch (error) {
        console.log(`    ✗ Localhost unavailable (is the dev server running?)`);
        results.push({
          project: project.name,
          page: pagePath,
          production: productionFile,
          localhost: "",
          status: "localhost-unavailable",
        });
        continue;
      }

      results.push({
        project: project.name,
        page: pagePath,
        production: productionFile,
        localhost: localhostFile,
        status: "success",
      });
    }
  }

  await browser.close();

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("COMPARISON SUMMARY");
  console.log("=".repeat(60));

  for (const result of results) {
    const statusIcon = {
      success: "✅",
      "localhost-unavailable": "⚠️",
      "production-unavailable": "❌",
    }[result.status];

    console.log(`${statusIcon} ${result.project} ${result.page}`);

    if (result.status === "success") {
      console.log(`   Production: ${result.production}`);
      console.log(`   Localhost:  ${result.localhost}`);
    } else if (result.status === "localhost-unavailable") {
      console.log(`   Note: Start the localhost dev server to compare`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Screenshots saved to:", SCREENSHOT_DIR);
  console.log("Use an image diff tool to compare production vs localhost");
  console.log("=".repeat(60));
}

// Run comparison
compare().catch(console.error);
