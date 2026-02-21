import { type Page, expect } from '@playwright/test';
import { shadowLocator, shadowQueryCount, getHighlights, SELECTORS } from './selectors';

/**
 * Custom assertion helpers for astro-inline-review acceptance tests.
 * All assertions interact through the browser — no source code imports.
 */

/**
 * Assert that the shadow DOM host element exists on the page.
 */
export async function expectHostExists(page: Page): Promise<void> {
  const host = page.locator(`#astro-inline-review-host`);
  await expect(host).toBeAttached();
}

/**
 * Assert that the shadow DOM host does NOT exist on the page.
 */
export async function expectHostNotExists(page: Page): Promise<void> {
  const host = page.locator(`#astro-inline-review-host`);
  await expect(host).not.toBeAttached();
}

/**
 * Assert that a highlight mark exists for the given text.
 */
export async function expectHighlightExists(page: Page, text: string): Promise<void> {
  // Use expect.poll for auto-retry — highlights are applied asynchronously after the API call
  await expect.poll(async () => {
    const highlights = getHighlights(page);
    const allHighlights = await highlights.all();

    for (const highlight of allHighlights) {
      const content = await highlight.textContent();
      if (content?.includes(text)) {
        return true;
      }
    }
    return false;
  }, {
    message: `Expected highlight containing "${text}" to exist`,
    timeout: 5000,
  }).toBe(true);
}

/**
 * Assert that no highlight mark exists for the given text.
 */
export async function expectHighlightNotExists(page: Page, text: string): Promise<void> {
  const highlights = getHighlights(page);
  const count = await highlights.count();

  for (let i = 0; i < count; i++) {
    const content = await highlights.nth(i).textContent();
    expect(
      content?.includes(text) ?? false,
      `Expected no highlight containing "${text}" but found one`,
    ).toBe(false);
  }
}

/**
 * Assert the FAB badge shows a specific count.
 */
export async function expectBadgeCount(page: Page, count: number): Promise<void> {
  const badge = shadowLocator(page, SELECTORS.fabBadge);
  if (count === 0) {
    // Badge should be hidden or not exist when count is 0
    const isVisible = await badge.isVisible().catch(() => false);
    expect(isVisible, 'Expected badge to be hidden when count is 0').toBe(false);
  } else {
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(String(count));
  }
}

/**
 * Assert the review panel is open.
 * Uses the data-air-state attribute rather than CSS visibility.
 */
export async function expectPanelOpen(page: Page): Promise<void> {
  const panel = shadowLocator(page, SELECTORS.panel);
  await expect(panel).toHaveAttribute('data-air-state', 'open');
}

/**
 * Assert the review panel is closed.
 * Uses the data-air-state attribute rather than CSS visibility.
 */
export async function expectPanelClosed(page: Page): Promise<void> {
  const panel = shadowLocator(page, SELECTORS.panel);
  await expect(panel).toHaveAttribute('data-air-state', 'closed');
}

/**
 * Assert the popup is visible.
 */
export async function expectPopupVisible(page: Page): Promise<void> {
  const popup = shadowLocator(page, SELECTORS.popup);
  await expect(popup).toHaveAttribute('data-air-state', 'visible');
}

/**
 * Assert the popup is not visible.
 */
export async function expectPopupHidden(page: Page): Promise<void> {
  const popup = shadowLocator(page, SELECTORS.popup);
  await expect(popup).toHaveAttribute('data-air-state', 'hidden');
}

/**
 * Assert the FAB is visible.
 */
export async function expectFabVisible(page: Page): Promise<void> {
  const fab = shadowLocator(page, SELECTORS.fab);
  await expect(fab).toBeVisible();
}

/**
 * Assert the total number of highlight marks on the page.
 */
export async function expectHighlightCount(page: Page, count: number): Promise<void> {
  const highlights = getHighlights(page);
  await expect(highlights).toHaveCount(count);
}

/**
 * Assert the number of annotation items in the panel.
 */
export async function expectAnnotationItemCount(page: Page, count: number): Promise<void> {
  const items = shadowLocator(page, SELECTORS.annotationItem);
  await expect(items).toHaveCount(count);
}

/**
 * Assert the number of page note items in the panel.
 */
export async function expectPageNoteCount(page: Page, count: number): Promise<void> {
  const items = shadowLocator(page, SELECTORS.pageNoteItem);
  await expect(items).toHaveCount(count);
}

/**
 * Assert a toast notification is visible with optional text check.
 */
export async function expectToastVisible(page: Page, text?: string): Promise<void> {
  const toast = shadowLocator(page, SELECTORS.toast);
  await expect(toast).toBeVisible();
  if (text) {
    await expect(toast).toContainText(text);
  }
}

/**
 * Assert the number of elements matching a selector inside the shadow DOM.
 */
export async function expectShadowElementCount(
  page: Page,
  selector: string,
  count: number,
): Promise<void> {
  const actual = await shadowQueryCount(page, selector);
  expect(actual, `Expected ${count} elements matching "${selector}", got ${actual}`).toBe(count);
}

/**
 * Assert that the page has no console errors.
 * Should be called after setting up a console error listener.
 */
export function createConsoleErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}
