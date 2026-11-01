import { test, expect, seedMember } from "./fixtures";

test("employee layout matches authenticated frame without manager navigation (mocked account linkage)", async ({ data, page }) => {
  const member = await seedMember(data, `Employee layout ${Date.now()}`);
  await data.setViewEnabled(member.id, true);
  const workspace = await data.mainWorkspace();
  await page.route("**/rpc/list_workspaces", async (route) => {
    const response = await route.fetch();
    const rows: { id: string; access_level: string }[] = await response.json();
    await route.fulfill({ response, json: rows.filter((row) => row.id === workspace).map((row) => ({ ...row, access_level: "member" })) });
  });
  await page.route("**/rpc/my_member", (route) => route.fulfill({
    json: [{ id: member.id, name: member.name, view_token: member.view_token }],
  }));
  await page.goto("/#/?keep=layout");
  await expect(page.getByTestId("member-home-tab")).toHaveText(`${member.name} · Evaluation`);
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByTestId("app-footer")).toHaveCount(1);
  await expect(page.getByTestId("sign-out-button")).toBeVisible();
  await expect(page.getByTestId("tab-team")).toHaveCount(0);
  await expect(page.getByTestId("reference-button")).toHaveCount(0);
  await expect(page.getByTestId("add-member-button")).toHaveCount(0);
  const goals = page.getByRole("banner").getByRole("link", { name: "SMART Goals", exact: true });
  await goals.click();
  await expect(page).toHaveURL(/keep=layout.*tab=goals/);
  await page.reload();
  await expect(goals).toHaveAttribute("aria-current", "page");
  await page.getByRole("banner").getByRole("link", { name: "Evaluation", exact: true }).click();
  await page.goBack();
  await expect(goals).toHaveAttribute("aria-current", "page");
});
