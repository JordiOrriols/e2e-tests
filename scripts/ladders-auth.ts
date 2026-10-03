import { chromium, type Browser } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectConfigs } from "../playwright.config";

/**
 * Signs the test users in and stores their sessions for Playwright to reuse.
 *
 * Runs against the Supabase password grant directly instead of driving the app's
 * login dialog. That keeps the auth setup independent from the login UI, which
 * is being moved into the shared @jordiorriols/ui library and would otherwise
 * break these tests every time it changes.
 *
 * Credentials come from the environment. The Supabase URL and publishable key
 * are public values read from the app's own .env.
 *
 * Two accounts exist: the primary one owns the data, the secondary one is the
 * other side of a shared team. The secondary is optional, because an account
 * that has not confirmed its email yet cannot sign in; the sharing suite skips
 * the collaborator side until it can.
 */

const LAD_DIR = resolve(import.meta.dirname, "../../ladders");

export const PRIMARY_STATE_PATH = resolve(
  import.meta.dirname,
  "../auth/ladders-storage-state.json",
);

export const SECOND_STATE_PATH = resolve(
  import.meta.dirname,
  "../auth/ladders-storage-state-2.json",
);

/** True when the collaborator session is available for the sharing suite. */
export function hasSecondAccount(): boolean {
  return existsSync(SECOND_STATE_PATH);
}

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

/** Seeds a session into a throwaway context and saves the resulting state. */
async function saveStorageState(
  browser: Browser,
  storageKey: string,
  session: SupabaseSession,
  statePath: string,
): Promise<void> {
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

  await context.storageState({ path: statePath });
  await context.close();
}

type Account = {
  email: string;
  password: string;
  statePath: string;
  /** The primary account owns the seeded data, so it cannot be skipped. */
  required: boolean;
};

export default async function globalSetup(): Promise<void> {
  // The sign-in is only needed for the local ladders app. Skip it for website,
  // airmap and ladders-production runs so they do not depend on these credentials.
  if (!runsLaddersLocalhost()) {
    return;
  }

  const appEnv = readAppEnv();
  const url = appEnv.VITE_SUPABASE_URL;
  const publishableKey = appEnv.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "ladders/.env is missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  const accounts: Account[] = [
    {
      email: process.env.LADDERS_TEST_EMAIL ?? "",
      password: process.env.LADDERS_TEST_PASSWORD ?? "",
      statePath: PRIMARY_STATE_PATH,
      required: true,
    },
    {
      email: process.env.LADDERS_TEST2_EMAIL ?? "",
      password: process.env.LADDERS_TEST2_PASSWORD ?? "",
      statePath: SECOND_STATE_PATH,
      required: false,
    },
  ];

  const primary = accounts[0];
  if (!primary.email || !primary.password) {
    throw new Error(
      "Set LADDERS_TEST_EMAIL and LADDERS_TEST_PASSWORD to run the ladders tests. " +
        "On this machine they are resolved from the login keychain via ~/.zshrc.",
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const account of accounts) {
      if (!account.email || !account.password) {
        if (account.required) continue;
        console.warn(
          "[ladders-auth] second account not configured, sharing suite will skip the collaborator side",
        );
        continue;
      }
      try {
        const session = await signIn(
          url,
          publishableKey,
          account.email,
          account.password,
        );
        await saveStorageState(
          browser,
          `sb-${projectRef(url)}-auth-token`,
          session,
          account.statePath,
        );
        console.log(`[ladders-auth] signed in and saved ${account.statePath}`);
      } catch (error) {
        if (account.required) throw error;
        // A registered but unconfirmed account cannot sign in. That is a state
        // of the account, not a broken suite, so warn instead of failing.
        console.warn(
          `[ladders-auth] second account could not sign in (${
            error instanceof Error ? error.message.split("\n")[0] : "unknown"
          }), sharing suite will skip the collaborator side`,
        );
      }
    }
  } finally {
    await browser.close();
  }
}
