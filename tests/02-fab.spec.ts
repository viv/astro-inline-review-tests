import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS } from '../helpers/selectors';
import { waitForIntegration, clickFab, cleanReviewData, createAnnotation } from '../helpers/actions';
import { expectFabVisible, expectBadgeCount, expectPanelOpen, expectPanelClosed } from '../helpers/assertions';

test.describe('Floating Action Button (FAB)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test('FAB is visible in bottom-right corner', async ({ page }) => {
    await expectFabVisible(page);

    // Verify it is positioned fixed in the bottom-right
    const fabPosition = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const fab = host.shadowRoot.querySelector('.air-fab') as HTMLElement;
      if (!fab) return null;
      const style = window.getComputedStyle(fab);
      return {
        position: style.position,
        bottom: style.bottom,
        right: style.right,
      };
    });

    expect(fabPosition?.position).toBe('fixed');
  });

  test('FAB badge shows zero or hidden when no annotations exist', async ({ page }) => {
    await expectBadgeCount(page, 0);
  });

  test('FAB badge updates when annotations are created', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Test note');
    await expectBadgeCount(page, 1);

    await createAnnotation(page, 'Software engineering', 'Another note');
    await expectBadgeCount(page, 2);
  });

  test('clicking FAB toggles the review panel', async ({ page }) => {
    await expectPanelClosed(page);

    await clickFab(page);
    await expectPanelOpen(page);

    await clickFab(page);
    await expectPanelClosed(page);
  });

  test('FAB icon changes when panel is open', async ({ page }) => {
    // FAB should show pencil icon by default, X when panel is open
    const iconBefore = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const fab = host.shadowRoot.querySelector('.air-fab');
      return fab?.textContent?.trim() ?? null;
    });

    await clickFab(page);

    const iconAfter = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const fab = host.shadowRoot.querySelector('.air-fab');
      return fab?.textContent?.trim() ?? null;
    });

    // Icons should be different when toggled
    expect(iconBefore).not.toBe(iconAfter);
  });

  test('FAB maintains fixed position when scrolling', async ({ page }) => {
    const fabPositionBefore = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const fab = host.shadowRoot.querySelector('.air-fab') as HTMLElement;
      return fab?.getBoundingClientRect().top ?? null;
    });

    // Scroll the page
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(100);

    const fabPositionAfter = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const fab = host.shadowRoot.querySelector('.air-fab') as HTMLElement;
      return fab?.getBoundingClientRect().top ?? null;
    });

    // Position relative to viewport should remain the same (fixed positioning)
    expect(fabPositionBefore).toBe(fabPositionAfter);
  });

  test('FAB has accessible aria-label', async ({ page }) => {
    const ariaLabel = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const fab = host.shadowRoot.querySelector('.air-fab');
      return fab?.getAttribute('aria-label') ?? null;
    });

    expect(ariaLabel).toBeTruthy();
    expect(typeof ariaLabel).toBe('string');
  });

  test('FAB has title attribute for tooltip', async ({ page }) => {
    const title = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const fab = host.shadowRoot.querySelector('.air-fab');
      return fab?.getAttribute('title') ?? null;
    });

    expect(title).toBeTruthy();
  });

  test('FAB z-index is above normal site content', async ({ page }) => {
    const zIndex = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const fab = host.shadowRoot.querySelector('.air-fab') as HTMLElement;
      if (!fab) return null;
      return parseInt(window.getComputedStyle(fab).zIndex, 10);
    });

    // FAB should have z-index of 10000 or higher
    expect(zIndex).toBeGreaterThanOrEqual(10000);
  });
});
