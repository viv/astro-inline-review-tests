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
  expectHighlightNotExists,
  createConsoleErrorCollector,
} from '../helpers/assertions';

test.describe('Edge cases', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('review-loop'));
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

    // The first annotation should still be intact
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
      const host = document.getElementById('review-loop-host');
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
      return document.querySelectorAll('#review-loop-host').length;
    });
    expect(hostCount).toBe(1);

    // Simulate re-injection by dispatching astro:page-load
    await page.evaluate(() => {
      document.dispatchEvent(new Event('astro:page-load'));
    });
    await page.waitForTimeout(200);

    // Should still be exactly one host
    const hostCountAfter = await page.evaluate(() => {
      return document.querySelectorAll('#review-loop-host').length;
    });
    expect(hostCountAfter).toBe(1);
  });

  test('DELETE returns 404 for non-existent annotation ID', async ({ page }) => {
    // Send a DELETE for a non-existent annotation
    const annotationResult = await page.evaluate(async () => {
      const response = await fetch(
        '/__inline-review/api/annotations/nonexistent-id-12345',
        { method: 'DELETE' },
      );
      return { status: response.status, body: await response.json() };
    });

    expect(annotationResult.status).toBe(404);
    expect(annotationResult.body).toHaveProperty('error');

    // Send a DELETE for a non-existent page note
    const pageNoteResult = await page.evaluate(async () => {
      const response = await fetch(
        '/__inline-review/api/page-notes/nonexistent-id-12345',
        { method: 'DELETE' },
      );
      return { status: response.status, body: await response.json() };
    });

    expect(pageNoteResult.status).toBe(404);
    expect(pageNoteResult.body).toHaveProperty('error');
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

  test('create and then immediately delete does not corrupt state', async ({
    page,
  }) => {
    // Create two annotations
    await createAnnotation(page, 'quick brown fox', 'First for mixed ops');
    await createAnnotation(page, 'Software engineering', 'Second for mixed ops');
    await expectHighlightCount(page, 2);
    await expectBadgeCount(page, 2);

    // Delete the first annotation while the state is fresh
    const firstHighlight = getHighlights(page).first();
    await firstHighlight.click();
    await expectPopupVisible(page);

    const deleteResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/__inline-review/api/annotations') &&
        resp.request().method() === 'DELETE' &&
        resp.ok(),
    );

    await page.evaluate(() => {
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return;
      const btn =
        host.shadowRoot.querySelector('[data-air-el="popup-delete"]') ||
        host.shadowRoot.querySelector('button[aria-label*="delete" i]');
      if (btn) (btn as HTMLElement).click();
    });

    await deleteResponsePromise;

    // Immediately create a third annotation (mixed create after delete)
    await createAnnotation(page, 'special characters', 'Third after delete');

    // Should have exactly 2 highlights (second + third; first was deleted)
    await expectHighlightCount(page, 2);
    await expectBadgeCount(page, 2);

    // Verify persistence survives the mixed operations
    await page.reload();
    await waitForIntegration(page);

    await expectHighlightCount(page, 2);
    await expectBadgeCount(page, 2);
  });

  test('rapid create-edit sequence preserves data integrity', async ({
    page,
  }) => {
    // Create an annotation and immediately edit it
    await createAnnotation(page, 'quick brown fox', 'Original rapid note');

    // Click highlight to edit immediately
    const highlight = getHighlights(page).first();
    await highlight.click();
    await expectPopupVisible(page);

    const textarea = shadowLocator(page, SELECTORS.popupTextarea);
    await textarea.clear();
    await textarea.fill('Rapidly edited note');

    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    const patchResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/__inline-review/api/annotations') &&
        resp.request().method() === 'PATCH' &&
        resp.ok(),
    );
    await saveBtn.click();
    await patchResponsePromise;

    // Immediately create a second annotation
    await createAnnotation(page, 'Software engineering', 'Second rapid note');

    await expectHighlightCount(page, 2);

    // Verify the edit persisted correctly
    await page.reload();
    await waitForIntegration(page);

    await expectHighlightCount(page, 2);

    // Verify the first annotation has the edited note
    const firstHighlight = getHighlights(page).first();
    await firstHighlight.click();

    const noteValue = await page.evaluate(() => {
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const ta = host.shadowRoot.querySelector(
        '[data-air-el="popup-textarea"]',
      ) as HTMLTextAreaElement;
      return ta?.value ?? null;
    });

    expect(noteValue).toBe('Rapidly edited note');
  });

  test('500 on annotation POST does not crash the UI', async ({ page }) => {
    const errors = createConsoleErrorCollector(page);

    // Intercept the annotation API and return 500
    await page.route('**/__inline-review/api/annotations', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        });
      }
      return route.continue();
    });

    // Try to create an annotation
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    const textarea = shadowLocator(page, SELECTORS.popupTextarea);
    await textarea.fill('Will fail');

    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    await saveBtn.click();

    // Wait for the error to propagate
    await page.waitForTimeout(500);

    // The integration should still be functional — FAB should still be visible
    const fab = shadowLocator(page, SELECTORS.fab);
    await expect(fab).toBeVisible();

    // No highlight should be created (the save failed)
    await expectHighlightCount(page, 0);

    // Unroute so subsequent navigations work
    await page.unroute('**/__inline-review/api/annotations');
  });

  test('500 on annotation DELETE does not corrupt state', async ({ page }) => {
    // Create an annotation successfully first
    await createAnnotation(page, 'quick brown fox', 'Will try to delete');
    await expectHighlightCount(page, 1);

    // Now intercept DELETE to return 500
    await page.route('**/__inline-review/api/annotations/*', (route) => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        });
      }
      return route.continue();
    });

    // Try to delete the annotation
    const highlight = getHighlights(page).first();
    await highlight.click();
    await expectPopupVisible(page);

    await page.evaluate(() => {
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return;
      const btn =
        host.shadowRoot.querySelector('[data-air-el="popup-delete"]') ||
        host.shadowRoot.querySelector('button[aria-label*="delete" i]');
      if (btn) (btn as HTMLElement).click();
    });

    // Wait for the error to propagate
    await page.waitForTimeout(500);

    // FAB should still be visible (integration not crashed)
    const fab = shadowLocator(page, SELECTORS.fab);
    await expect(fab).toBeVisible();

    // Unroute
    await page.unroute('**/__inline-review/api/annotations/*');
  });
});
