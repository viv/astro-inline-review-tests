import { test, expect } from '@playwright/test';
import { getHighlights, shadowLocator, SELECTORS } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  openPanel,
  switchPanelTab,
} from '../helpers/actions';
import {
  expectHighlightExists,
  expectHighlightNotExists,
  expectHighlightCount,
  expectBadgeCount,
} from '../helpers/assertions';

test.describe('Multi-page behaviour', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test('annotations are scoped to the page URL', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Home annotation');

    await page.goto('/second');
    await waitForIntegration(page);
    await createAnnotation(page, 'wallaby bounces', 'Second annotation');

    // Go back to home — should only see home annotations
    await page.goto('/');
    await waitForIntegration(page);
    await expectHighlightExists(page, 'quick brown fox');

    // The second page text doesn't exist on home, so just check count
    await expectBadgeCount(page, 1);
  });

  test('badge shows count for current page only', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Home 1');
    await createAnnotation(page, 'Software engineering', 'Home 2');
    await expectBadgeCount(page, 2);

    // Navigate to second page
    await page.goto('/second');
    await waitForIntegration(page);
    await createAnnotation(page, 'wallaby bounces', 'Second 1');
    await expectBadgeCount(page, 1); // Only second page count

    // Navigate to empty page
    await page.goto('/empty');
    await waitForIntegration(page);
    await expectBadgeCount(page, 0);

    // Back to home
    await page.goto('/');
    await waitForIntegration(page);
    await expectBadgeCount(page, 2);
  });

  test('navigating between pages updates badge correctly', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Badge nav test');
    await expectBadgeCount(page, 1);

    await page.goto('/second');
    await waitForIntegration(page);
    await expectBadgeCount(page, 0);

    await page.goto('/');
    await waitForIntegration(page);
    await expectBadgeCount(page, 1);
  });

  test('All Pages tab shows annotations from all visited pages', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Home note');

    await page.goto('/second');
    await waitForIntegration(page);
    await createAnnotation(page, 'wallaby bounces', 'Second note');

    await openPanel(page);
    await switchPanelTab(page, 'all-pages');

    const panelContent = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]');
      return panel?.textContent ?? null;
    });

    // Should contain content from both pages
    expect(panelContent).toContain('quick brown fox');
    expect(panelContent).toContain('wallaby bounces');
  });

  test('annotations on page A do not appear as highlights on page B', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Home only');

    // Navigate to second page
    await page.goto('/second');
    await waitForIntegration(page);

    // No highlights should exist on the second page
    // (the text "quick brown fox" doesn't exist on second page, but verify no stray marks)
    const highlightCount = await getHighlights(page).count();
    expect(highlightCount).toBe(0);
  });

  test('page notes are scoped correctly across pages', async ({ page }) => {
    await openPanel(page);

    // Add page note on home
    const addBtn = shadowLocator(page, SELECTORS.pageNoteAdd);
    await addBtn.click();
    const textarea = shadowLocator(page, SELECTORS.pageNoteTextarea);
    await textarea.fill('Home page note');
    await textarea.press('Enter');

    // Navigate to second page
    await page.goto('/second');
    await waitForIntegration(page);

    await openPanel(page);
    await switchPanelTab(page, 'this-page');

    // Should not show home page note on second page
    const panelContent = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]');
      return panel?.textContent ?? null;
    });

    expect(panelContent).not.toContain('Home page note');
  });

  test('export includes annotations from all pages', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Export home');

    await page.goto('/second');
    await waitForIntegration(page);
    await createAnnotation(page, 'wallaby bounces', 'Export second');

    await page.waitForTimeout(500);

    // Fetch export via API
    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    expect(exportContent).toContain('quick brown fox');
    expect(exportContent).toContain('Export home');
    expect(exportContent).toContain('wallaby bounces');
    expect(exportContent).toContain('Export second');
  });

  test('Astro view transitions preserve annotation state', async ({ page }) => {
    // This test verifies that if the fixture site uses view transitions,
    // annotations survive the soft navigation.
    // Note: the fixture site may not use view transitions — this test documents
    // the expected behaviour if/when they're enabled.
    await createAnnotation(page, 'quick brown fox', 'View transition test');
    await expectHighlightExists(page, 'quick brown fox');

    // Navigate via link click (which would use view transitions if enabled)
    await page.click('nav a[href="/second"]');
    await waitForIntegration(page);

    // Navigate back
    await page.click('nav a[href="/"]');
    await waitForIntegration(page);

    // Annotations should still be present
    await expectHighlightExists(page, 'quick brown fox');
    await expectBadgeCount(page, 1);
  });
});
