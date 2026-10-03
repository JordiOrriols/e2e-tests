import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectConfigs } from "../playwright.config";

/**
 * Signs a test user in and stores the session for Playwright to reuse.
 *
 * Runs against the Supabase password grant directly instead of driving the app's
 * login dialog. That keeps the auth setup independent from the login UI, which
 * is being moved into the shared @jordiorriols/ui library and would otherwise
 * break these tests every time it changes.
 *
 * Credentials come from the environment (LADDERS_TEST_EMAIL /
 * LADDERS_TEST_PASSWORD). The Supabase URL and publishable key are public values
 * read from the app's own .env.
 */

const LAD_DIR = resolve(import.meta.dirname, "../../ladders");
const STATE_PATH = resolve(
  import.meta.dirname,
  "../auth/ladders-storage-state.json",
);

type Env = Record<string, string | undefined>;

function readAppEnv(): Env {
  const env: Env = {};
  const raw = readFileSync(resolve(LAD_DIR, ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match?.[1]) env[match[1]] = match[2];
  }
  return env;
}

/** supabase-js derives its storage key from the project reference in the URL. */
function projectRef(url: string): string {
  const ref = new URL(url).hostname.split(".")[0];
  if (!ref)
    throw new Error(`Could not derive the project reference from ${url}`);
  return ref;
}

/**
 * True when this run includes ladders-localhost.
 *
 * Playwright does not expose the selected projects to global setup, so this
 * inspects the CLI flags. Without a project filter every project runs, so the
 * sign-in is needed then too.
 */
function runsLaddersLocalhost(): boolean {
  const cli = process.argv.join(" ");
  const filtered = /(^|\s)(-p|--project)[= ]/.test(cli);
  if (!filtered) return true;
  return /ladders-localhost/.test(cli);
}

/** Shape supabase-js persists under its storage key and reads back on boot. */
type SupabaseSession = {
  access_token: string;
  token_type: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  user: unknown;
};

/**
 * Signs in through Supabase's password grant. Done with fetch rather than the
 * SDK to avoid adding @supabase/supabase-js to this project just for the setup.
 */
async function signIn(
  url: string,
  publishableKey: string,
  email: string,
  password: string,
): Promise<SupabaseSession> {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Could not sign in the ladders test user (${response.status}): ${body.slice(0, 200)}`,
    );
  }

  const {
    access_token,
    token_type,
    expires_at,
    expires_in,
    refresh_token,
    user,
  } = (await response.json()) as SupabaseSession;

  return {
    access_token,
    token_type,
    expires_at,
    expires_in,
    refresh_token,
    user,
  };
}

export default async function globalSetup(): Promise<void> {
  // The sign-in is only needed for the local ladders app. Skip it for website,
  // airmap and ladders-production runs so they do not depend on these credentials.
  if (!runsLaddersLocalhost()) {
    return;
  }

  const email = process.env.LADDERS_TEST_EMAIL;
  const password = process.env.LADDERS_TEST_PASSWORD;

  const appEnv = readAppEnv();
  const url = appEnv.VITE_SUPABASE_URL;
  const publishableKey = appEnv.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "ladders/.env is missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY",
    );
  }
  if (!email || !password) {
    throw new Error(
      "Set LADDERS_TEST_EMAIL and LADDERS_TEST_PASSWORD to run the ladders tests. " +
        "On this machine they are resolved from the login keychain via ~/.zshrc.",
    );
  }

  const {
    access_token,
    refresh_token,
    expires_at,
    expires_in,
    token_type,
    user,
  } = await signIn(url, publishableKey, email, password);

  const storageKey = `sb-${projectRef(url)}-auth-token`;
  const session: SupabaseSession = {
    access_token,
    refresh_token,
    expires_at,
    expires_in,
    token_type,
    user,
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Seed the session before any app script runs.
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [storageKey, JSON.stringify(session)] as const,
  );

  await page.goto(projectConfigs.ladders.localhost);
  await page.waitForLoadState("domcontentloaded");

  await context.storageState({ path: STATE_PATH });
  await browser.close();

  console.log(`[ladders-auth] signed in as ${email} and saved ${STATE_PATH}`);
}
