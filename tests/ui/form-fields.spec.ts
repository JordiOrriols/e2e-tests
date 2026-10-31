import { test, expect } from "@playwright/test";

test("shared form fields preserve labels, values, native validation and reset", async ({ page }) => {
  await page.goto("/iframe.html?id=components-formfield--native-form&viewMode=story");
  const form = page.getByRole("form", { name: "Release" });
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  const notes = page.getByRole("textbox", { name: "Notes", exact: true });
  const status = page.getByRole("combobox", { name: "Status", exact: true });
  await expect(form).toBeVisible();
  await expect(notes).toHaveAttribute("aria-describedby", /-description$/);
  await page.getByText("Notes", { exact: true }).click();
  await expect(notes).toBeFocused();
  await title.fill("Release");
  await notes.fill("Updated notes");
  await status.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("option", { name: "QA", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Submitted fields")).toHaveText(
    JSON.stringify({ title: "Release", notes: "Updated notes", status: "qa" }),
  );
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(title).toHaveValue("Website");
  await expect(notes).toHaveValue("Initial notes");
  await expect(status).toHaveText("Draft");
  await expect(page.getByLabel("Submitted fields")).toBeEmpty();
  await notes.fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(notes).toBeFocused();
  await expect(page.getByLabel("Submitted fields")).toBeEmpty();
  await expect(notes).toHaveAttribute("required", "");
});

test("shared field errors and textarea styles remain accessible at desktop and mobile sizes", async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/iframe.html?id=components-formfield--with-error&viewMode=story");
    const input = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert")).toHaveText("Name is required.");
    await expect(input).toHaveAttribute("aria-describedby", /-description .*?-error$/);
    await expect(input).toBeInViewport();
    await page.goto("/iframe.html?id=components-formfield--textarea-field&viewMode=story");
    const textarea = page.getByRole("textbox", { name: "Release notes", exact: true });
    await expect(textarea).toBeInViewport();
    await textarea.focus();
    await expect(textarea).toBeFocused();
    const geometry = await textarea.boundingBox();
    expect(geometry!.height).toBeGreaterThanOrEqual(96);
    expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(viewport.width);
    await page.goto("/iframe.html?id=components-textarea--disabled&viewMode=story");
    await expect(page.getByRole("textbox", { name: "Notes" })).toBeDisabled();
  }
});
