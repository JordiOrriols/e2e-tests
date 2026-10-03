import { expect, test } from "./fixtures";
import { LaddersApp } from "./ladders-app";

/**
 * Requesting a password reset via email.
 */

test.describe("Ladders password reset @password-reset", () => {
  test("a user can request a password reset with valid email", async ({
    page,
  }) => {
    const app = new LaddersApp(page);
    await app.gotoHome();

    // Go to login dialog
    await expect(page.getByTestId("sign-in-button")).toBeVisible();
    await page.getByTestId("sign-in-button").click();

    // Click forgot password
    await page.getByText("Forgot password?").click();

    // Enter a valid email address and request reset
    const emailInput = page.locator("#email");
    await expect(emailInput).toBeVisible();
    await emailInput.fill("test@example.com");

    // Click send reset email
    const resetButton = page.getByRole("button", { name: "Send reset email" });
    await expect(resetButton).toBeVisible();
    await resetButton.click();

    // Should show success message
    await expect(page.getByText("Check your email")).toBeVisible();
  });

  test("a user gets error for invalid email format", async ({ page }) => {
    const app = new LaddersApp(page);
    await app.gotoHome();

    // Go to login dialog
    await page.getByTestId("sign-in-button").click();

    // Click forgot password
    await page.getByText("Forgot password?").click();

    // Enter an invalid email and try reset
    const emailInput = page.locator("#email");
    await emailInput.fill("invalid-email");

    const resetButton = page.getByRole("button", { name: "Send reset email" });
    await resetButton.click();

    // Should show error message - likely validation or system error
    // For simplicity we test that the form tries to process it
    // Since Supabase handles this in backend, we just expect an error message
    await expect(page.getByText(/invalid|error/)).toBeVisible();
  });
});
