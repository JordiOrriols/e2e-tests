import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  addFeatures, api, authenticatedPage, createRoster, removeRoster, seedRoadmap, selectWorkspace, signIn,
  DATA_TIMEOUT,
} from "./planner-helpers";

// Planner e2e already runs against the sibling checkout's dev server.
const LOCALES = fileURLToPath(new URL("../../../planner/src/locales", import.meta.url));
type Tree = { [key: string]: string | Tree };
const leaves = (tree: Tree, prefix = ""): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[prefix + key, value] as [string, string]] : leaves(value, `${prefix}${key}.`));

/** English strings that read differently in Catalan; seeing one after switching means text skipped i18n. */
function englishOnly(): Map<string, string> {
  const read = (lang: string) => new Map(leaves(JSON.parse(readFileSync(`${LOCALES}/${lang}.json`, "utf8"))));
  const [en, ca] = [read("en"), read("ca")];
  const result = new Map<string, string>();
  for (const [key, value] of en)
    if (!value.includes("{{") && ca.get(key) !== value) result.set(value.trim(), key);
  return result;
}

async function untranslated(page: Page, english: Map<string, string>) {
  const texts = await page.evaluate(() => {
    const found = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent && parent.closest("[hidden],[aria-hidden=true]") === null) found.add(node.textContent!.trim());
    }
    for (const element of Array.from(document.querySelectorAll("[aria-label],[title],[placeholder]")))
      for (const attribute of ["aria-label", "title", "placeholder"])
        if (element.getAttribute(attribute)) found.add(element.getAttribute(attribute)!.trim());
    return Array.from(found);
  });
  return texts.filter(text => english.has(text)).map(text => `${english.get(text)}: "${text}"`);
}

test("switching to Catalan translates every Planner page and persists after a reload", async ({ browser }) => {
  test.skip(!existsSync(LOCALES), "Needs the Planner checkout next to e2e-tests");
  test.setTimeout(120_000);
  const english = englishOnly();
  const owner = await signIn();
  const teamName = `Idioma ${randomUUID().slice(0, 8)}`;
  // Member names stay out of the English strings so they are not mistaken for UI text.
  const roster = await createRoster(owner, teamName, [
    { name: "Núria", planning_role: "backend" }, { name: "Jordi", planning_role: "frontend" },
  ]);
  const workspace = await seedRoadmap(owner, roster.team.id, []);
  await addFeatures(owner, workspace.id, [
    { name: "Pagament", backend_devs: 2, backend_weeks: 2, frontend_devs: 1, frontend_weeks: 2, priority: 0, in_backlog: true },
    { name: "Cercador", design_devs: 1, design_weeks: 1, qa_devs: 1, qa_weeks: 1, in_backlog: false },
  ]);
  const { page, context } = await authenticatedPage(browser, owner);
  try {
    await selectWorkspace(page, workspace.name);
    await page.getByTestId("language-selector").click();
    await page.getByTestId("language-button-ca").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ca");
    await page.reload();
    const workspaceMenu = page.getByRole("button", { name: "Espai de treball", exact: true });
    await expect(workspaceMenu).toBeVisible({ timeout: DATA_TIMEOUT });
    // The selected workspace does not survive a reload, so pick it again.
    await workspaceMenu.click();
    await page.getByRole("menuitemradio", { name: workspace.name, exact: true }).click();
    await expect(workspaceMenu).toHaveAttribute("title", workspace.name);
    await expect(page.locator("html")).toHaveAttribute("lang", "ca");
    await expect(page.getByTestId("header-subtitle")).toHaveText("Estimació i planificació de projectes");

    const tabs = page.getByRole("navigation", { name: "Pàgines de Planner", exact: true });
    await expect(tabs.getByRole("link")).toHaveText(["Estimació", "Full de ruta", "Vacances", "Configuració de l'equip"]);
    const pages = [
      { tab: "Estimació", ready: page.getByRole("article", { name: "Pagament" }) },
      { tab: "Full de ruta", ready: page.getByLabel(/Pagament$/).first() },
      { tab: "Vacances", ready: page.getByRole("region", { name: "Velocitat de l'equip" }) },
      { tab: "Configuració de l'equip", ready: page.getByRole("checkbox", { name: teamName }) },
    ];
    for (const { tab, ready } of pages) {
      await tabs.getByRole("link", { name: tab, exact: true }).click();
      await expect(ready).toBeVisible();
      expect(await untranslated(page, english), `English text left on ${tab}`).toEqual([]);
    }
    // Menus and dialogs render in portals, so check them open too.
    await workspaceMenu.click();
    expect(await untranslated(page, english), "English text in the workspace menu").toEqual([]);
    await page.keyboard.press("Escape");
    await tabs.getByRole("link", { name: "Estimació", exact: true }).click();
    await page.getByRole("article", { name: "Pagament" }).getByRole("button").first().click();
    await expect(page.getByRole("dialog").or(page.getByRole("alertdialog"))).toBeVisible();
    expect(await untranslated(page, english), "English text in the feature editor").toEqual([]);
  } finally {
    await context.close();
    await api(owner, `planner_workspaces?id=eq.${workspace.id}`, { method: "DELETE" });
    await removeRoster(owner, roster.team.id);
  }
});
