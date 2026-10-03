import { test, expect, seedMember } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";

/**
 * Credentials for the account the suite authenticates with.
 *
 * globalSetup already signs in with them to build the storage state, so a run
 * that gets this far already has them; asking again keeps the failure message
 * pointing at the real cause instead of an empty email.
 */
function credentials() {
  const email = process.env.LADDERS_TEST_EMAIL;
  const password = process.env.LADDERS_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "LADDERS_TEST_EMAIL and LADDERS_TEST_PASSWORD are required for the auth suite",
    );
  }
  return { email, password };
}

test.describe("Ladders auth", () => {
  test("signing out leaves the app and signing back in returns to it", async ({
    page,
  }) => {
    const app = new LaddersApp(page);
    const { email, password } = credentials();
    await app.gotoHome();

    await app.signOut();
    await expect(app.welcomePage).toBeVisible();
    await expect(page.getByTestId("header")).toHaveCount(0);

    await app.signIn(email, password);
    await expect(page.getByTestId("header")).toBeVisible();
    await expect(page.getByTestId("sign-out-button")).toBeVisible();
  });

  test("a wrong password is reported and nobody gets in", async ({ page }) => {
    const app = new LaddersApp(page);
    const { email } = credentials();
    await app.gotoHome();
    await app.signOut();

    await app.signIn(email, "not-the-password");
    await expect(app.loginError).toBeVisible();
    // Still on the welcome page: a rejected sign in must not half open the app.
    await expect(app.welcomePage).toBeVisible();
    await expect(page.getByTestId("header")).toHaveCount(0);
  });

  test("the forgot password step does not ask for a password", async ({
    page,
  }) => {
    const app = new LaddersApp(page);
    await app.gotoHome();
    await app.signOut();
    await app.openSignIn();

    await page
      .getByRole("button", { name: /forgot|reset|olvid|pass/i })
      .click();

    await expect(page.getByTestId("login-email")).toBeVisible();
    await expect(page.getByTestId("login-password")).toHaveCount(0);
    await expect(page.getByTestId("login-submit")).toBeVisible();
  });

  test("shared links open for a visitor who never signed in", async ({
    shared,
    data,
  }) => {
    const memberName = uniqueName("E2E Anonymous");
    const member = await seedMember(data, memberName);

    await shared.open(`/#/e/${member.self_token}`);

    // EntryGate only guards the app itself; the shared route has to work.
    await expect(shared.page.getByTestId("welcome-page")).toHaveCount(0);
    await expect(shared.page.getByTestId("assessment-name")).toHaveValue(
      memberName,
    );
  });
});
