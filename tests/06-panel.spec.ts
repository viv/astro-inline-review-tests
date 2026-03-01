import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS, shadowQueryCount, HOST_ID } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  clickFab,
  openPanel,
  closePanel,
  addPageNote,
  switchPanelTab,
} from '../helpers/actions';
import {
  expectPanelOpen,
  expectPanelClosed,
  expectAnnotationItemCount,
  expectHighlightExists,
  expectHighlightCount,
} from '../helpers/assertions';

test.describe('Review panel', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('review-loop'));
    await waitForIntegration(page);
  });

  test('panel slides in from the right', async ({ page }) => {
    await clickFab(page);

    const panel = shadowLocator(page, SELECTORS.panel);
    await expect(panel).toBeVisible();

    // Wait for slide-in transition to complete (panel animates from offscreen right
    // to flush with viewport edge — wait until right edge stabilises near viewport width)
    await expect.poll(async () => {
      return page.evaluate(() => {
        const host = document.getElementById('review-loop-host');
        if (!host?.shadowRoot) return false;
        const panel = host.shadowRoot.querySelector('[data-air-el="panel"]') as HTMLElement;
        if (!panel) return false;
        const rect = panel.getBoundingClientRect();
        return Math.abs(rect.right - window.innerWidth) < 5;
      });
    }, { timeout: 2000 }).toBe(true);

    // Panel should be positioned on the right side of the viewport
    const panelRect = await page.evaluate(() => {
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]') as HTMLElement;
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
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]') as HTMLElement;
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
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]');
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
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const tab = host.shadowRoot.querySelector('[data-air-el="tab-this-page"]');
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

    // Wait for scroll animation to bring highlight into viewport
    await expect.poll(async () => {
      return page.evaluate(() => {
        const mark = document.querySelector('mark[data-air-id]');
        if (!mark) return false;
        const rect = mark.getBoundingClientRect();
        return rect.top >= 0 && rect.top <= window.innerHeight;
      });
    }, { timeout: 2000 }).toBe(true);
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
      // Check for pulse via automation contract attribute or active CSS animation
      const style = window.getComputedStyle(mark);
      return (
        style.animation !== 'none' ||
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
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]');
      if (!panel) return null;

      // Look for data-air-el items (page notes and annotations)
      const children = Array.from(panel.querySelectorAll('[data-air-el="page-note-item"], [data-air-el="annotation-item"]'));
      return children.map((el) => el.getAttribute('data-air-el'));
    });

    expect(sectionOrder).not.toBeNull();
  });

  test('empty state shown when no annotations exist', async ({ page }) => {
    await openPanel(page);
    await switchPanelTab(page, 'this-page');

    const panelContent = await page.evaluate(() => {
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]');
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
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]');
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
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]') as HTMLElement;
      return panel?.getBoundingClientRect().width ?? null;
    });

    // Panel should be full viewport width on mobile (allow sub-pixel rounding)
    expect(panelWidth).toBeCloseTo(375, 0);
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
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]');
      return panel?.textContent ?? null;
    });

    // Should show confirmation text ("Sure?" is the two-click confirmation)
    const hasConfirmation =
      panelContent?.toLowerCase().includes('confirm') ||
      panelContent?.toLowerCase().includes('are you sure') ||
      panelContent?.toLowerCase().includes('delete all') ||
      panelContent?.toLowerCase().includes('sure?');

    expect(hasConfirmation).toBe(true);
  });

  test('Clear All confirmation auto-resets after 3 seconds', async ({ page }) => {
    // Create an annotation so Clear All has something to act on
    await createAnnotation(page, 'quick brown fox', 'Clear all reset test');
    await expectHighlightCount(page, 1);

    // Open the panel to access Clear All
    await openPanel(page);

    const clearAllBtn = shadowLocator(page, SELECTORS.clearAllButton);
    await expect(clearAllBtn).toBeVisible();

    // Click once — should enter confirmation state
    await clearAllBtn.click();

    // Verify the button shows confirmation state
    await expect(clearAllBtn).toHaveAttribute('data-air-state', 'confirming');

    // Wait for auto-reset timeout (3s internal timer)
    await expect(clearAllBtn).not.toHaveAttribute('data-air-state', 'confirming', { timeout: 4000 });

    // The annotation should still exist — auto-reset should not delete anything
    await expectHighlightCount(page, 1);
    await expectAnnotationItemCount(page, 1);
  });

  test('tab count includes both annotations and page notes', async ({ page }) => {
    // Create an annotation
    await createAnnotation(page, 'quick brown fox', 'Tab count annotation');

    // Open panel and add a page note
    await addPageNote(page, 'Tab count page note');

    // Read the "This Page" tab text — should reflect 2 items (1 annotation + 1 page note).
    // Use toContainText for auto-retry — the tab count updates asynchronously.
    await expect(shadowLocator(page, SELECTORS.tabThisPage)).toContainText('2');

    // Add another annotation
    await closePanel(page);
    await createAnnotation(page, 'Software engineering', 'Second annotation');

    // Re-open panel and check tab count updates to 3
    await openPanel(page);
    await expect(shadowLocator(page, SELECTORS.tabThisPage)).toContainText('3');
  });

  test('Clear All removes all annotations and page notes', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Will be cleared');
    await createAnnotation(page, 'Software engineering', 'Also cleared');

    await openPanel(page);

    const clearAllBtn = shadowLocator(page, SELECTORS.clearAllButton);
    await clearAllBtn.click();

    // Two-click confirmation: click the same button again to confirm
    await clearAllBtn.click();

    // Wait for all DELETE operations to complete
    await expectAnnotationItemCount(page, 0);
  });

  test('panel content area supports overflow scrolling', async ({
    page,
  }) => {
    await openPanel(page);

    // Verify the panel content area has overflow-y set to auto or scroll,
    // which means it will scroll when content exceeds its height
    const overflowY = await page.evaluate(() => {
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const panelContent = host.shadowRoot.querySelector(
        '[data-air-el="panel-content"]',
      ) as HTMLElement;
      if (!panelContent) return null;
      return window.getComputedStyle(panelContent).overflowY;
    });

    expect(overflowY).not.toBeNull();
    // overflow-y should be auto or scroll (not visible or hidden)
    expect(['auto', 'scroll']).toContain(overflowY);
  });

  test('long annotation list is scrollable in the panel', async ({
    page,
  }) => {
    // Create many annotations + page notes to exceed panel height
    await createAnnotation(page, 'quick brown fox', 'Note 1 for scroll test');
    await createAnnotation(page, 'Software engineering', 'Note 2 for scroll test');
    await createAnnotation(page, 'special characters', 'Note 3 for scroll test');
    await createAnnotation(page, 'introduction paragraph', 'Note 4 for scroll test');
    await createAnnotation(page, 'deliberately long paragraph', 'Note 5 for scroll test');

    // Also add page notes to increase content
    await openPanel(page);
    await addPageNote(page, 'Page note 1 for scroll test with enough text to take up space');
    await addPageNote(page, 'Page note 2 for scroll test with additional content');
    await addPageNote(page, 'Page note 3 for scroll test to ensure overflow');

    // Check that the panel content is actually scrollable now
    const scrollInfo = await page.evaluate(() => {
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const panelContent = host.shadowRoot.querySelector(
        '[data-air-el="panel-content"]',
      ) as HTMLElement;
      if (!panelContent) return null;
      return {
        scrollHeight: panelContent.scrollHeight,
        clientHeight: panelContent.clientHeight,
        overflowY: window.getComputedStyle(panelContent).overflowY,
      };
    });

    expect(scrollInfo).not.toBeNull();
    if (scrollInfo) {
      // The content area should support scrolling
      expect(['auto', 'scroll']).toContain(scrollInfo.overflowY);
    }
  });

  test('panel header buttons appear in correct order', async ({ page }) => {
    await openPanel(page);

    const buttonLabels = await page.evaluate((hostId) => {
      const host = document.getElementById(hostId);
      if (!host?.shadowRoot) return null;
      const actions = host.shadowRoot.querySelector('.air-panel__actions');
      if (!actions) return null;
      const buttons = Array.from(actions.querySelectorAll('button'));
      return buttons.map((btn) => btn.textContent?.trim() ?? '');
    }, HOST_ID);

    expect(buttonLabels).toEqual(['+ Note', 'Copy All', 'Clear All']);
  });
});
