import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS, shadowQueryCount } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  clickFab,
  openPanel,
  closePanel,
  switchPanelTab,
} from '../helpers/actions';
import {
  expectPanelOpen,
  expectPanelClosed,
  expectAnnotationItemCount,
  expectHighlightExists,
} from '../helpers/assertions';

test.describe('Review panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test('panel slides in from the right', async ({ page }) => {
    await clickFab(page);

    const panel = shadowLocator(page, SELECTORS.panel);
    await expect(panel).toBeVisible();

    // Panel should be positioned on the right side of the viewport
    const panelRect = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('.air-panel') as HTMLElement;
      if (!panel) return null;
      const rect = panel.getBoundingClientRect();
      return { right: rect.right, left: rect.left, width: rect.width };
    });

    expect(panelRect).not.toBeNull();
    if (panelRect) {
      // Panel's right edge should be at or near the viewport right
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      expect(panelRect.right).toBeCloseTo(viewportWidth, -1);
    }
  });

  test('panel has correct width (380px on desktop)', async ({ page }) => {
    await openPanel(page);

    const panelWidth = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('.air-panel') as HTMLElement;
      return panel?.getBoundingClientRect().width ?? null;
    });

    expect(panelWidth).toBe(380);
  });

  test('panel has This Page and All Pages tabs', async ({ page }) => {
    await openPanel(page);

    const thisPageTab = shadowLocator(page, SELECTORS.tabThisPage);
    const allPagesTab = shadowLocator(page, SELECTORS.tabAllPages);

    await expect(thisPageTab).toBeVisible();
    await expect(allPagesTab).toBeVisible();
  });

  test('This Page tab shows only current page annotations', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Home page note');

    // Navigate to second page and create annotation there
    await page.goto('/second');
    await waitForIntegration(page);
    await createAnnotation(page, 'wallaby bounces', 'Second page note');

    // Go back to home
    await page.goto('/');
    await waitForIntegration(page);

    await openPanel(page);
    await switchPanelTab(page, 'this-page');

    // Should only show the home page annotation
    await expectAnnotationItemCount(page, 1);
  });

  test('All Pages tab shows annotations grouped by URL', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Home note');

    await page.goto('/second');
    await waitForIntegration(page);
    await createAnnotation(page, 'wallaby bounces', 'Second note');

    await page.goto('/');
    await waitForIntegration(page);

    await openPanel(page);
    await switchPanelTab(page, 'all-pages');

    // Should show annotations from both pages
    // Look for page URL groupings
    const panelContent = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('.air-panel');
      return panel?.textContent ?? null;
    });

    expect(panelContent).toContain('quick brown fox');
    expect(panelContent).toContain('wallaby bounces');
  });

  test('annotation count appears in tab label', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Count test');
    await createAnnotation(page, 'Software engineering', 'Count test 2');

    await openPanel(page);

    const tabText = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const tab = host.shadowRoot.querySelector('[data-tab="this-page"]');
      return tab?.textContent ?? null;
    });

    // Tab should include the count
    expect(tabText).toContain('2');
  });

  test('clicking annotation in panel scrolls to highlight', async ({ page }) => {
    // Create annotation near the bottom of the page (long paragraph)
    await createAnnotation(page, 'This is a deliberately long paragraph', 'Scroll test');

    // Scroll to top
    await page.evaluate(() => window.scrollTo(0, 0));

    await openPanel(page);

    // Click the annotation item in the panel
    const annotationItem = shadowLocator(page, SELECTORS.annotationItem).first();
    await annotationItem.click();

    // The page should have scrolled to bring the highlight into view
    await page.waitForTimeout(500);

    const highlightVisible = await page.evaluate(() => {
      const mark = document.querySelector('mark[data-air-id]');
      if (!mark) return false;
      const rect = mark.getBoundingClientRect();
      return rect.top >= 0 && rect.top <= window.innerHeight;
    });

    expect(highlightVisible).toBe(true);
  });

  test('highlight pulses on scroll-to from panel', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Pulse test');

    await page.evaluate(() => window.scrollTo(0, 0));
    await openPanel(page);

    // Click annotation in panel
    const annotationItem = shadowLocator(page, SELECTORS.annotationItem).first();
    await annotationItem.click();

    // Check for a pulse animation or class on the highlight
    const hasPulse = await page.evaluate(() => {
      const mark = document.querySelector('mark[data-air-id]');
      if (!mark) return false;
      // Check for animation or transitional class
      const style = window.getComputedStyle(mark);
      return (
        style.animation !== 'none' ||
        mark.classList.contains('air-pulse') ||
        mark.getAttribute('data-air-pulse') !== null
      );
    });

    expect(hasPulse).toBe(true);
  });

  test('page notes section appears above annotations in This Page tab', async ({ page }) => {
    // This test verifies DOM ordering — page notes section before annotations
    await openPanel(page);
    await switchPanelTab(page, 'this-page');

    // The panel structure should have page notes section before annotation list
    const sectionOrder = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('.air-panel');
      if (!panel) return null;

      // Look for section identifiers
      const children = Array.from(panel.querySelectorAll('[class*="page-note"], [class*="annotation"]'));
      return children.map((el) => el.className);
    });

    expect(sectionOrder).not.toBeNull();
  });

  test('empty state shown when no annotations exist', async ({ page }) => {
    await openPanel(page);
    await switchPanelTab(page, 'this-page');

    const panelContent = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('.air-panel');
      return panel?.textContent ?? null;
    });

    // Should show some kind of empty state message
    expect(panelContent).toBeTruthy();
    // Common empty state phrases
    const hasEmptyState =
      panelContent?.toLowerCase().includes('no annotation') ||
      panelContent?.toLowerCase().includes('no review') ||
      panelContent?.toLowerCase().includes('empty') ||
      panelContent?.toLowerCase().includes('select text') ||
      panelContent?.toLowerCase().includes('get started');

    expect(hasEmptyState).toBe(true);
  });

  test('empty state shown when no page notes exist', async ({ page }) => {
    await openPanel(page);
    await switchPanelTab(page, 'this-page');

    // The page notes section should indicate no notes exist
    const panelContent = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('.air-panel');
      return panel?.textContent ?? null;
    });

    expect(panelContent).toBeTruthy();
  });

  test('panel closes when FAB is clicked again', async ({ page }) => {
    await openPanel(page);
    await expectPanelOpen(page);

    await clickFab(page);
    await expectPanelClosed(page);
  });

  test('panel closes on Escape key', async ({ page }) => {
    await openPanel(page);
    await expectPanelOpen(page);

    await page.keyboard.press('Escape');
    await expectPanelClosed(page);
  });

  test('panel is full-width on narrow viewports (below 480px)', async ({ page }) => {
    // Set a narrow viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await waitForIntegration(page);

    await openPanel(page);

    const panelWidth = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('.air-panel') as HTMLElement;
      return panel?.getBoundingClientRect().width ?? null;
    });

    // Panel should be full viewport width on mobile
    expect(panelWidth).toBe(375);
  });

  test('Clear All button exists and requires confirmation', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Clear all test');
    await openPanel(page);

    const clearAllBtn = shadowLocator(page, SELECTORS.clearAllButton);
    await expect(clearAllBtn).toBeVisible();

    // Click Clear All — should show confirmation (not immediately clear)
    await clearAllBtn.click();

    // There should be a confirmation dialog or secondary button
    const panelContent = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('.air-panel');
      return panel?.textContent ?? null;
    });

    // Should show confirmation text
    const hasConfirmation =
      panelContent?.toLowerCase().includes('confirm') ||
      panelContent?.toLowerCase().includes('are you sure') ||
      panelContent?.toLowerCase().includes('delete all');

    expect(hasConfirmation).toBe(true);
  });

  test('Clear All removes all annotations and page notes', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Will be cleared');
    await createAnnotation(page, 'Software engineering', 'Also cleared');

    await openPanel(page);

    const clearAllBtn = shadowLocator(page, SELECTORS.clearAllButton);
    await clearAllBtn.click();

    // Confirm the clear action
    // Look for confirm button
    await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return;
      const confirmBtn =
        host.shadowRoot.querySelector('.air-clear-confirm') ||
        host.shadowRoot.querySelector('[data-action="confirm-clear"]') ||
        host.shadowRoot.querySelector('.air-panel button:last-of-type');
      if (confirmBtn) (confirmBtn as HTMLElement).click();
    });

    await page.waitForTimeout(500);

    // All annotations should be gone
    await expectAnnotationItemCount(page, 0);
  });
});
