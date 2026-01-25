import type { Page } from "@playwright/test";

/**
 * Language code type
 */
export type LanguageCode = "en" | "es" | "ca";

/**
 * Get current page language from HTML lang attribute or localStorage
 */
export async function getCurrentLanguage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Try HTML lang attribute
    const htmlLang = document.documentElement.lang;
    if (htmlLang) return htmlLang.split("-")[0];
    
    // Try localStorage
    const stored = localStorage.getItem("i18nextLng");
    if (stored) return stored.split("-")[0];
    
    return null;
  });
}

/**
 * Switch language using the language selector
 */
export async function switchLanguage(
  page: Page,
  languageCode: LanguageCode
): Promise<void> {
  const selector = page.locator('nav[aria-label="Language selection"]');
  const button = selector.getByRole("button", { 
    name: new RegExp(languageCode, "i") 
  });
  
  await button.click();
  await page.waitForTimeout(300);
}

/**
 * Verify text changes after language switch
 */
export async function verifyLanguageSwitch(
  page: Page,
  translations: Record<LanguageCode, string>
): Promise<boolean> {
  for (const [lang, expectedText] of Object.entries(translations)) {
    await switchLanguage(page, lang as LanguageCode);
    const hasText = await page.getByText(expectedText).isVisible();
    if (!hasText) return false;
  }
  return true;
}

/**
 * Get all visible text content
 */
export async function getAllVisibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    return document.body.innerText;
  });
}
