import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  createAnnotationWithoutNote,
  openPanel,
  closePanel,
  addPageNote,
  readReviewJson,
  writeReviewJson,
  switchPanelTab,
} from '../helpers/actions';
import {
  expectHighlightCount,
  expectBadgeCount,
  expectPageNoteCount,
} from '../helpers/assertions';

test.describe('Coverage gaps — low priority', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test('T6: invalid JSON schema recovery — wrong version resets to empty store', async ({
    page,
  }) => {
    // Create an annotation first so there is data to lose
    await createAnnotation(page, 'quick brown fox', 'Schema test note');
    await page.waitForTimeout(500);

    // Write valid JSON but with an invalid schema (wrong version + wrong shape)
    writeReviewJson(JSON.stringify({ version: 2, data: 'wrong shape' }));

    // Also clear localStorage so the client can't fall back to cache
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));

    // Reload — server should reject the invalid schema and return an empty store
    await page.reload();
    await waitForIntegration(page);

    // No highlights should be present (data was discarded)
    await expectHighlightCount(page, 0);
    await expectBadgeCount(page, 0);
  });

  test('T7: tab count includes both annotations and page notes', async ({ page }) => {
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

  test('T8: DELETE returns 404 for non-existent annotation ID', async ({ page }) => {
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

  test('T9: export — annotation with empty note produces no blockquote', async ({ page }) => {
    // Create an annotation WITHOUT a note (empty note)
    await createAnnotationWithoutNote(page, 'quick brown fox');
    await page.waitForTimeout(500);

    // Fetch the export via API
    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    // The selected text should appear in the export as bold
    expect(exportContent).toContain('**"quick brown fox"**');

    // There should be NO blockquote line for this annotation's note.
    // Split the export into lines and check that no `>` line follows the annotation.
    const lines = exportContent.split('\n');
    const annotationLineIdx = lines.findIndex((l: string) =>
      l.includes('**"quick brown fox"**'),
    );
    expect(annotationLineIdx).toBeGreaterThanOrEqual(0);

    // The next non-empty line after the annotation should NOT be a blockquote
    const nextLines = lines.slice(annotationLineIdx + 1);
    const nextContentLine = nextLines.find((l: string) => l.trim().length > 0);
    if (nextContentLine) {
      expect(nextContentLine.trimStart().startsWith('>')).toBe(false);
    }
  });

  test('T10: + Note button toggles form visibility', async ({ page }) => {
    await openPanel(page);

    const addBtn = shadowLocator(page, SELECTORS.pageNoteAdd);
    const textarea = shadowLocator(page, SELECTORS.pageNoteTextarea);

    // Initially, the textarea should not be visible
    await expect(textarea).not.toBeVisible();

    // Click + Note — textarea should appear
    await addBtn.click();
    await expect(textarea).toBeVisible();

    // Click + Note again — textarea should disappear (toggle off)
    await addBtn.click();
    await expect(textarea).not.toBeVisible();

    // Click + Note a third time — textarea should appear again (toggle on)
    await addBtn.click();
    await expect(textarea).toBeVisible();
  });
});
