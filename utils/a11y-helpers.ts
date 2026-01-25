import type { Page } from "@playwright/test";

/**
 * Accessibility testing utilities
 */

/**
 * Check for basic accessibility issues
 */
export async function checkBasicA11y(page: Page): Promise<{
  issues: string[];
  passed: boolean;
}> {
  const issues: string[] = [];

  // Check for images without alt text
  const imagesWithoutAlt = await page.evaluate(() => {
    const images = Array.from(document.querySelectorAll("img"));
    return images.filter(img => !img.alt).length;
  });
  if (imagesWithoutAlt > 0) {
    issues.push(`${imagesWithoutAlt} image(s) without alt text`);
  }

  // Check for buttons without accessible name
  const buttonsWithoutName = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.filter(
      btn => !btn.textContent?.trim() && !btn.getAttribute("aria-label")
    ).length;
  });
  if (buttonsWithoutName > 0) {
    issues.push(`${buttonsWithoutName} button(s) without accessible name`);
  }

  // Check for links without text
  const linksWithoutText = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a"));
    return links.filter(
      link => !link.textContent?.trim() && !link.getAttribute("aria-label")
    ).length;
  });
  if (linksWithoutText > 0) {
    issues.push(`${linksWithoutText} link(s) without accessible text`);
  }

  // Check for form inputs without labels
  const inputsWithoutLabels = await page.evaluate(() => {
    const inputs = Array.from(
      document.querySelectorAll("input, textarea, select")
    );
    return inputs.filter(input => {
      const id = input.id;
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const hasAriaLabel = input.getAttribute("aria-label");
      const hasAriaLabelledBy = input.getAttribute("aria-labelledby");
      return !hasLabel && !hasAriaLabel && !hasAriaLabelledBy;
    }).length;
  });
  if (inputsWithoutLabels > 0) {
    issues.push(`${inputsWithoutLabels} input(s) without associated labels`);
  }

  // Check color contrast (basic check)
  const lowContrastElements = await page.evaluate(() => {
    const getContrastRatio = (color1: string, color2: string): number => {
      // Simplified contrast calculation
      const getLuminance = (color: string): number => {
        const rgb = color.match(/\d+/g);
        if (!rgb || rgb.length < 3) return 0;
        const [r, g, b] = rgb.map(Number);
        const [rs, gs, bs] = [r, g, b].map(c => {
          c = c / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      };
      
      const l1 = getLuminance(color1);
      const l2 = getLuminance(color2);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    };

    let count = 0;
    const textElements = document.querySelectorAll("p, span, h1, h2, h3, h4, h5, h6, a, button");
    textElements.forEach(el => {
      const style = window.getComputedStyle(el);
      const color = style.color;
      const bgColor = style.backgroundColor;
      if (bgColor !== "rgba(0, 0, 0, 0)" && getContrastRatio(color, bgColor) < 4.5) {
        count++;
      }
    });
    return count;
  });
  if (lowContrastElements > 0) {
    issues.push(`${lowContrastElements} element(s) may have low color contrast`);
  }

  return {
    issues,
    passed: issues.length === 0,
  };
}

/**
 * Check keyboard navigation
 */
export async function checkKeyboardNavigation(page: Page): Promise<{
  focusableElements: number;
  canTabThrough: boolean;
}> {
  const focusableElements = await page.evaluate(() => {
    const focusable = document.querySelectorAll(
      'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    return focusable.length;
  });

  // Try tabbing through elements
  let tabCount = 0;
  const maxTabs = Math.min(focusableElements, 20);
  
  while (tabCount < maxTabs) {
    await page.keyboard.press("Tab");
    tabCount++;
    
    const activeElement = await page.evaluate(() => {
      return document.activeElement?.tagName;
    });
    
    if (!activeElement || activeElement === "BODY") {
      break;
    }
  }

  return {
    focusableElements,
    canTabThrough: tabCount > 0,
  };
}

/**
 * Check page has proper heading structure
 */
export async function checkHeadingStructure(page: Page): Promise<{
  hasH1: boolean;
  headingOrder: string[];
  isValid: boolean;
}> {
  const headings = await page.evaluate(() => {
    const headingElements = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
    return Array.from(headingElements).map(h => h.tagName);
  });

  const hasH1 = headings.includes("H1");
  
  // Check if heading order is logical (no skipping levels)
  let isValid = true;
  let lastLevel = 0;
  
  for (const heading of headings) {
    const level = parseInt(heading.charAt(1));
    if (level > lastLevel + 1 && lastLevel !== 0) {
      isValid = false;
      break;
    }
    lastLevel = level;
  }

  return {
    hasH1,
    headingOrder: headings,
    isValid,
  };
}
