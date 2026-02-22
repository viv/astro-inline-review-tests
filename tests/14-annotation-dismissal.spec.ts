import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  createElementAnnotation,
  openPanel,
  deleteAnnotationFromPanel,
  seedOrphanAnnotation,
} from '../helpers/actions';
import {
  expectAnnotationItemCount,
  expectElementAnnotationItemCount,
  expectHighlightExists,
  expectHighlightNotExists,
  expectHighlightCount,
  expectBadgeCount,
  expectElementHighlightExists,
  expectElementHighlightNotExists,
  expectAnnotationOrphanIndicator,
  createConsoleErrorCollector,
} from '../helpers/assertions';

test.describe('Annotation dismissal', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
  });

  // --- Delete button presence ---

  test('text annotation item has delete button in panel', async ({ page }) => {
    await createAnnotation(page, 'introduction paragraph', 'needs work');
    await openPanel(page);

    const deleteBtn = shadowLocator(page, SELECTORS.annotationDelete);
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toHaveText('Delete');
  });

  test('element annotation item has delete button in panel', async ({ page }) => {
    await createElementAnnotation(page, '#hero-image', 'wrong image');
    await openPanel(page);

    const deleteBtn = shadowLocator(page, SELECTORS.annotationDelete);
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toHaveText('Delete');
  });

  // --- Delete text annotation ---

  test('deleting text annotation removes it from panel', async ({ page }) => {
    await createAnnotation(page, 'introduction paragraph', 'fix this');
    await openPanel(page);
    await expectAnnotationItemCount(page, 1);

    await deleteAnnotationFromPanel(page);

    await expectAnnotationItemCount(page, 0);
  });

  test('deleting text annotation removes highlight from page', async ({ page }) => {
    await createAnnotation(page, 'introduction paragraph', 'fix this');
    await expectHighlightExists(page, 'introduction paragraph');

    await openPanel(page);
    await deleteAnnotationFromPanel(page);

    await expectHighlightNotExists(page, 'introduction paragraph');
  });

  test('deleting text annotation updates badge count', async ({ page }) => {
    await createAnnotation(page, 'introduction paragraph', 'fix this');
    await expectBadgeCount(page, 1);

    await openPanel(page);
    await deleteAnnotationFromPanel(page);

    // Badge update is async (refreshBadge fires after the DELETE response)
    // so poll until the badge is hidden
    const badge = shadowLocator(page, SELECTORS.fabBadge);
    await expect(badge).not.toBeVisible({ timeout: 5000 });
  });

  test('deleted text annotation does not reappear after reload', async ({ page }) => {
    await createAnnotation(page, 'introduction paragraph', 'fix this');
    await openPanel(page);
    await deleteAnnotationFromPanel(page);

    await page.reload();
    await waitForIntegration(page);

    await expectHighlightCount(page, 0);
    await expectBadgeCount(page, 0);
  });

  // --- Delete element annotation ---

  test('deleting element annotation removes it from panel', async ({ page }) => {
    await createElementAnnotation(page, '#hero-image', 'wrong image');
    await openPanel(page);
    await expectElementAnnotationItemCount(page, 1);

    await deleteAnnotationFromPanel(page);

    await expectElementAnnotationItemCount(page, 0);
  });

  test('deleting element annotation removes outline from page', async ({ page }) => {
    await createElementAnnotation(page, '#hero-image', 'wrong image');
    await expectElementHighlightExists(page, '#hero-image');

    await openPanel(page);
    await deleteAnnotationFromPanel(page);

    await expectElementHighlightNotExists(page, '#hero-image');
  });

  // --- Orphan indicator ---

  test('orphan indicator shown when text cannot be located', async ({ page }) => {
    // Seed an annotation with text/XPath that doesn't exist on the page
    seedOrphanAnnotation();
    await page.reload();
    await waitForIntegration(page);

    await openPanel(page);
    await expectAnnotationItemCount(page, 1);
    await expectAnnotationOrphanIndicator(page, 1);
  });

  test('orphan indicator not shown for locatable annotation', async ({ page }) => {
    await createAnnotation(page, 'introduction paragraph', 'this exists');
    await openPanel(page);

    await expectAnnotationItemCount(page, 1);
    await expectAnnotationOrphanIndicator(page, 0);
  });

  // --- Navigate-to behaviour ---

  test('clicking non-orphan annotation scrolls to highlight', async ({ page }) => {
    // Create annotation on text that's below the fold — use the long paragraph
    await createAnnotation(page, 'Software engineering requires', 'check this');

    await openPanel(page);
    const item = shadowLocator(page, SELECTORS.annotationItem);
    await item.click();

    // Verify the highlight is now in view by checking it has scroll position
    await expect.poll(async () => {
      return page.evaluate(() => {
        const mark = document.querySelector('mark[data-air-id]');
        if (!mark) return false;
        const rect = mark.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      });
    }, {
      message: 'Expected highlight to be scrolled into view',
      timeout: 5000,
    }).toBe(true);
  });

  test('clicking orphan annotation does not error', async ({ page }) => {
    const errors = createConsoleErrorCollector(page);

    seedOrphanAnnotation();
    await page.reload();
    await waitForIntegration(page);

    await openPanel(page);
    const item = shadowLocator(page, SELECTORS.annotationItem);
    await item.click();

    // Give time for any errors to surface
    await page.waitForTimeout(500);

    // Filter out expected errors (if any) — we only care about astro-inline-review errors
    const reviewErrors = errors.filter(e => e.includes('astro-inline-review'));
    expect(reviewErrors).toHaveLength(0);
  });
});
