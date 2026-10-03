import { expect, test } from "./fixtures";
import { LaddersApp } from "./ladders-app";

test.describe("Ladders password reset @password-reset", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await new LaddersApp(page).openSignIn();
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByTestId("login-password")).toHaveCount(0);
  });

  test("a valid email delegates recovery and shows confirmation", async ({
    page,
  }) => {
    let requestedEmail: string | undefined;
    await page.route("**/auth/v1/recover**", async (route) => {
      requestedEmail = route.request().postDataJSON().email;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    });
    await page.getByTestId("login-email").fill("test@example.com");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-info")).toContainText(
      "Check your email",
    );
    expect(requestedEmail).toBe("test@example.com");
  });

  test("native email validation prevents a recovery request", async ({
    page,
  }) => {
    let requested = false;
    await page.route("**/auth/v1/recover**", async (route) => {
      requested = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    });
    const email = page.getByTestId("login-email");
    await email.fill("invalid-email");
    await page.getByTestId("login-submit").click();
    expect(
      await email.evaluate(
        (input: HTMLInputElement) => input.validity.typeMismatch,
      ),
    ).toBe(true);
    expect(requested).toBe(false);
    await expect(page.getByTestId("login-info")).toHaveCount(0);
  });

  test("recovery failures stay visible and permit a retry", async ({
    page,
  }) => {
    await page.route("**/auth/v1/recover**", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ msg: "Email rate limit exceeded" }),
      }),
    );
    await page.getByTestId("login-email").fill("test@example.com");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toContainText(
      "Email rate limit exceeded",
    );
    await expect(page.getByTestId("login-submit")).toBeEnabled();
    await expect(page.getByTestId("login-info")).toHaveCount(0);
  });
});
