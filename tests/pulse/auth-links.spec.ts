import { expect, test } from "@playwright/test";
import { PULSE_URL, signIn } from "./pulse-helpers";

test.describe("Pulse email links", () => {
  test("a recovery link with tokens in the hash asks for a new password and leaves the URL clean", async ({ page }) => {
    const account = (await signIn()) as Awaited<ReturnType<typeof signIn>> & { refresh_token: string };
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    const tokens = new URLSearchParams({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expires_in: "3600",
      token_type: "bearer",
      type: "recovery",
    });
    await page.goto(`${PULSE_URL}/?auth_app=pulse#${tokens}`);
    await expect(page.getByRole("alertdialog", { name: "Set a new password" })).toBeVisible({ timeout: 15_000 });
    expect(page.url()).not.toContain("access_token");
    expect(page.url()).not.toContain("auth_app");
  });

  test("an expired link says so on the welcome page instead of doing nothing", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    await page.goto(
      `${PULSE_URL}/?auth_app=pulse#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`
    );
    await expect(page.getByRole("alert")).toHaveText(
      "This link did not work: Email link is invalid or has expired. Ask for a new one from Sign in."
    );
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(page.url()).not.toContain("error");
  });
});
