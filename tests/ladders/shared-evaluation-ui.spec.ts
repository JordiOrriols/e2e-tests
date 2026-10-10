import { expect, seedMember, test } from "./fixtures";
import { LaddersApp, uniqueName } from "./ladders-app";
import { readAppEnv, type EvaluationRow } from "../../scripts/ladders-data";

test("shared self, peer and view pages reuse branding, language selection and footer", async ({ data, shared }) => {
  const member = await seedMember(data, uniqueName("E2E SharedHeader"));
  await data.setViewEnabled(member.id, true);
  for (const route of [`e/${member.self_token}`, `e/${member.peer_token}`, `v/${member.view_token}`]) {
    await shared.open(`/#/${route}`);
    await shared.page.waitForLoadState("networkidle");
    await expect(shared.page.getByTestId("page-message")).toHaveCount(0);
    const header = shared.page.getByTestId("assessment-header");
    await expect(header).toBeVisible();
    await expect(header.locator("svg.lucide-layout-grid")).toBeVisible();
    await shared.page.getByTestId("language-selector").click();
    await shared.page.getByRole("menuitemradio", { name: "Español" }).press("Enter");
    await expect(shared.page.getByRole("menuitemradio", { name: "Español" })).toBeHidden();
    await expect(shared.page.getByTestId("app-footer")).toHaveText("Hecho con amor por Jordi Orriols");
    await shared.page.getByTestId("language-selector").click();
    await shared.page.getByRole("menuitemradio", { name: "Català" }).press("Enter");
    await expect(shared.page.getByRole("menuitemradio", { name: "Català" })).toBeHidden();
    await expect(shared.page.getByTestId("app-footer")).toHaveText("Fet amb amor per Jordi Orriols");
    await shared.page.getByTestId("language-selector").click();
    await shared.page.getByRole("menuitemradio", { name: "English" }).press("Enter");
    await expect(shared.page.getByRole("menuitemradio", { name: "English" })).toBeHidden();
    await expect(shared.page.getByTestId("app-footer")).toHaveText("Made with love by Jordi Orriols");
    await shared.page.setViewportSize({ width: 375, height: 812 });
    await expect(shared.page.getByTestId("language-selector")).toBeVisible();
    expect(await shared.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(2);
    await shared.page.setViewportSize({ width: 1280, height: 720 });
  }
});

test("manager shares and hides each peer comment while the public API redacts private text", async ({ data, page, shared }) => {
  const member = await seedMember(data, uniqueName("E2E CommentPrivacy"));
  await data.setViewEnabled(member.id, true);
  const peer = await data.createEvaluation(member.id, {
    kind: "peer", status: "published", authorName: "Sam",
    currentLevels: { Technology: 3 },
    comments: { Technology: "Peer technology feedback", People: "Private peer people feedback" },
  });
  const manager = await data.createEvaluation(member.id, {
    kind: "manager", status: "published", comments: { Technology: "Manager technology feedback" },
  });
  const env = readAppEnv();
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error("Supabase test configuration missing");
  async function publicComments(id: string) {
    const response = await shared.page.request.post(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/public_view`, {
      headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY! },
      data: { p_token: member.view_token },
    });
    expect(response.ok()).toBe(true);
    const rows: EvaluationRow[] = await response.json();
    return rows.find((row) => row.id === id)?.comments;
  }
  expect(await publicComments(peer.id)).toEqual({});
  const app = new LaddersApp(page);
  await app.gotoHome();
  await app.openTeamMember(member.name);
  const technology = page.getByTestId(`comment-visibility-${peer.id}-Technology`);
  const people = page.getByTestId(`comment-visibility-${peer.id}-People`);
  await expect(technology).toHaveText("Share with employee");
  await expect(people).toHaveText("Share with employee");
  await technology.click();
  await expect(technology).toHaveText("Hide from employee");
  await expect.poll(() => publicComments(peer.id)).toEqual({ Technology: "Peer technology feedback" });
  await shared.open(`/#/v/${member.view_token}`);
  await shared.page.getByTestId("version-row").filter({ hasText: "Sam" }).getByTestId("version-compare").click();
  await expect(shared.page.getByTestId("comment-groups")).toContainText("Peer technology feedback");
  await expect(shared.page.getByText("Private peer people feedback", { exact: true })).toHaveCount(0);
  await technology.click();
  await expect(technology).toHaveText("Share with employee");
  await expect.poll(() => publicComments(peer.id)).toEqual({});
  const managerComment = page.getByTestId(`comment-visibility-${manager.id}-Technology`);
  await managerComment.click();
  await expect.poll(() => publicComments(manager.id)).toEqual({});
  await page.reload();
  await expect(page.getByTestId(`comment-visibility-${manager.id}-Technology`)).toHaveText("Share with employee");
  await shared.open(`/#/v/${member.view_token}`);
  await expect(shared.page.getByTestId("comment-groups")).toHaveCount(0);
});

test("footer remains available on welcome and invalid shared-link pages", async ({ shared }) => {
  for (const path of ["/", "/#/v/not-a-token"]) {
    await shared.open(path);
    await expect(shared.page.getByTestId("app-footer")).toHaveText("Made with love by Jordi Orriols");
    if (path.includes("/v/")) {
      await expect(shared.page.getByTestId("assessment-header").locator("svg.lucide-layout-grid")).toBeVisible();
      await expect(shared.page.getByTestId("language-selector")).toBeVisible();
    }
  }
});
