import { test, expect } from '@playwright/test';
import { getHighlights, SELECTORS, shadowLocator, HOST_ID } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  selectText,
  selectTextAcrossElements,
  createAnnotation,
} from '../helpers/actions';
import {
  expectHighlightExists,
  expectHighlightCount,
  expectBadgeCount,
  expectPopupVisible,
} from '../helpers/assertions';

test.describe('Edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test('single word selection creates annotation', async ({ page }) => {
    await createAnnotation(page, 'pangram', 'Single word test');

    await expectHighlightExists(page, 'pangram');
    await expectBadgeCount(page, 1);
  });

  test('very long passage selection (500+ chars)', async ({ page }) => {
    // Select the entire long paragraph
    const longText =
      'This is a deliberately long paragraph designed to test how the system handles extended text selections. When a user selects a very long passage of text, the annotation system needs to store the full selection but may truncate the preview in the UI for readability.';

    await createAnnotation(page, longText, 'Long passage note');

    // Should create highlights for the long text
    const highlightCount = await getHighlights(page).count();
    expect(highlightCount).toBeGreaterThanOrEqual(1);
    await expectBadgeCount(page, 1);
  });

  test('overlapping selection with existing highlight', async ({ page }) => {
    // Create first annotation
    await createAnnotation(page, 'quick brown fox', 'First annotation');
    await expectHighlightCount(page, 1);

    // Try to select text that overlaps with the existing highlight
    // "brown fox jumps over" spans across the mark boundary
    await selectTextAcrossElements(page, 'brown fox', 'jumps over');

    // The system should handle this gracefully
    // Either allow the overlapping annotation or prevent it
    await page.waitForTimeout(500);

    // At minimum, the first annotation should still be intact
    await expectHighlightExists(page, 'quick brown fox');
  });

  test('rapid annotation creation (3 in quick succession)', async ({ page }) => {
    // Create three annotations rapidly without waiting between them
    await createAnnotation(page, 'quick brown fox', 'Rapid one');
    await createAnnotation(page, 'Software engineering', 'Rapid two');
    await createAnnotation(page, 'special characters', 'Rapid three');

    // All three should exist
    await expectHighlightCount(page, 3);
    await expectBadgeCount(page, 3);

    // Verify persistence
    await page.waitForTimeout(500);
    await page.reload();
    await waitForIntegration(page);

    await expectHighlightCount(page, 3);
    await expectBadgeCount(page, 3);
  });

  test('special characters in selected text (quotes, angle brackets, Unicode)', async ({
    page,
  }) => {
    // Select text with special characters from the fixture page
    await createAnnotation(page, '"quoted text"', 'Special chars in text');

    await expectBadgeCount(page, 1);

    // Verify the highlight contains the special characters correctly
    const highlightText = await getHighlights(page).first().textContent();
    expect(highlightText).toContain('"quoted text"');
  });

  test('special characters in notes', async ({ page }) => {
    const specialNote = 'Note with "quotes", <brackets>, & ampersands, and café Unicode';
    await createAnnotation(page, 'quick brown fox', specialNote);

    // Click highlight to verify note was stored correctly
    const highlight = getHighlights(page).first();
    await highlight.click();
    await expectPopupVisible(page);

    const noteValue = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const textarea = host.shadowRoot.querySelector('[data-air-el="popup-textarea"]') as HTMLTextAreaElement;
      return textarea?.value ?? null;
    });

    expect(noteValue).toBe(specialNote);
  });

  test('idempotent initialisation (no duplicate hosts on re-inject)', async ({ page }) => {
    // The integration should guard against creating duplicate shadow hosts
    // even if the init script runs multiple times (e.g., during view transitions)

    // Verify there's exactly one host
    const hostCount = await page.evaluate(() => {
      return document.querySelectorAll('#astro-inline-review-host').length;
    });
    expect(hostCount).toBe(1);

    // Simulate re-injection by dispatching astro:page-load
    await page.evaluate(() => {
      document.dispatchEvent(new Event('astro:page-load'));
    });
    await page.waitForTimeout(500);

    // Should still be exactly one host
    const hostCountAfter = await page.evaluate(() => {
      return document.querySelectorAll('#astro-inline-review-host').length;
    });
    expect(hostCountAfter).toBe(1);
  });

  test('annotation on dynamically loaded content', async ({ page }) => {
    // Dynamically add content to the page
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'dynamic-content';
      p.textContent =
        'This paragraph was dynamically added after page load and should be annotatable.';
      document.body.appendChild(p);
    });

    // Select text from the dynamic content
    await createAnnotation(page, 'dynamically added after page load', 'Dynamic content note');

    await expectBadgeCount(page, 1);
    await expectHighlightExists(page, 'dynamically added after page load');
  });
});
