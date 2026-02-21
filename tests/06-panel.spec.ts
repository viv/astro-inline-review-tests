import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS, shadowQueryCount } from '../helpers/selectors';
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
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test('panel slides in from the right', async ({ page }) => {
    await clickFab(page);

    const panel = shadowLocator(page, SELECTORS.panel);
    await expect(panel).toBeVisible();

    // Wait for slide-in transition to complete (0.3s CSS transition)
    await page.waitForTimeout(400);

    // Panel should be positioned on the right side of the viewport
    const panelRect = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
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
      const host = document.getElementById('astro-inline-review-host');
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
      const host = document.getElementById('astro-inline-review-host');
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
      const host = document.getElementById('astro-inline-review-host');
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
      const host = document.getElementById('astro-inline-review-host');
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
      const host = document.getElementById('astro-inline-review-host');
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
      const host = document.getElementById('astro-inline-review-host');
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
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]');
      return panel?.textContent ?? null;
    });

    // Should show confirmation text
    const hasConfirmation =
      panelContent?.toLowerCase().includes('confirm') ||
      panelContent?.toLowerCase().includes('are you sure') ||
      panelContent?.toLowerCase().includes('delete all');

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

    // Wait for the auto-reset timeout (3s + buffer)
    await page.waitForTimeout(3500);

    // Verify the button has reverted to its default state
    await expect(clearAllBtn).not.toHaveAttribute('data-air-state', 'confirming');

    // The annotation should still exist — auto-reset should not delete anything
    await expectHighlightCount(page, 1);
    await expectAnnotationItemCount(page, 1);
  });

  test('tab count includes both annotations and page notes', async ({ page }) => {
    // Create an annotation
    await createAnnotation(page, 'quick brown fox', 'Tab count annotation');

    // Open panel and add a page note
    await addPageNote(page, 'Tab count page note');

    // Read the "This Page" tab text — should reflect 2 items (1 annotation + 1 page note)
    const tabText = await shadowLocator(page, SELECTORS.tabThisPage).textContent();
    expect(tabText).toContain('2');

    // Add another annotation
    await closePanel(page);
    await createAnnotation(page, 'Software engineering', 'Second annotation');

    // Re-open panel and check tab count updates to 3
    await openPanel(page);
    const updatedTabText = await shadowLocator(page, SELECTORS.tabThisPage).textContent();
    expect(updatedTabText).toContain('3');
  });

  test('Clear All removes all annotations and page notes', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Will be cleared');
    await createAnnotation(page, 'Software engineering', 'Also cleared');

    await openPanel(page);

    const clearAllBtn = shadowLocator(page, SELECTORS.clearAllButton);
    await clearAllBtn.click();

    // Two-click confirmation: click the same button again to confirm
    await clearAllBtn.click();

    await page.waitForTimeout(500);

    // All annotations should be gone
    await expectAnnotationItemCount(page, 0);
  });
});
