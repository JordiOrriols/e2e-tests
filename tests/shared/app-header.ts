import { expect, type Page } from "@playwright/test";

/** Mirrors `PROJECTS` in `@jordiorriols/ui` (src/lib/projects.ts); add new apps here too. */
export const PROJECTS = [
  { id: "ladders", name: "Ladders", url: "https://ladders.jordiorriols.cat/", icon: "lucide-trending-up" },
  { id: "planner", name: "Planner", url: "https://planner.jordiorriols.cat/", icon: "lucide-square-chart-gantt" },
] as const;

const iconClass = (svg: Element) =>
  Array.from(svg.classList).filter(name => name.startsWith("lucide-") && name !== "lucide-icon");

/**
 * The shared header icon opens the project switcher: the trigger shows only
 * the current app's registry icon (no arrow) and the menu lists every app with
 * that same icon, marking the current one.
 */
export async function expectProjectSwitcher(page: Page, current: (typeof PROJECTS)[number]["id"]) {
  const project = PROJECTS.find(item => item.id === current)!;
  const trigger = page.getByRole("button", { name: "Switch project", exact: true });
  await expect(trigger.locator("svg")).toHaveCount(1);
  const triggerIcon = await trigger.locator("svg").evaluate(iconClass);
  expect(triggerIcon.join(" ")).toContain(project.icon);

  await trigger.click();
  const menu = page.getByRole("menu");
  const items = menu.getByRole("menuitem");
  await expect(items).toHaveText(PROJECTS.map(item => item.name));
  for (const item of PROJECTS) {
    const link = menu.getByRole("menuitem", { name: item.name, exact: true });
    await expect(link).toHaveAttribute("href", item.url);
    expect((await link.locator("svg").first().evaluate(iconClass)).join(" ")).toContain(item.icon);
    if (item.id === current) await expect(link).toHaveAttribute("aria-current", "page");
    else await expect(link).not.toHaveAttribute("aria-current", /.*/);
  }
  // The trigger and the menu entry draw the same icon for the current app.
  expect(await menu.getByRole("menuitem", { name: project.name, exact: true }).locator("svg").first().evaluate(iconClass))
    .toEqual(triggerIcon);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
}
