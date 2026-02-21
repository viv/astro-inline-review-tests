import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS, getHighlights } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  openPanel,
  closePanel,
  addPageNote,
  readReviewJson,
  writeReviewJson,
  switchPanelTab,
} from '../helpers/actions';
import {
  expectHighlightExists,
  expectHighlightCount,
  expectBadgeCount,
  expectAnnotationItemCount,
  expectPageNoteCount,
} from '../helpers/assertions';

test.describe('Coverage gaps — high priority', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test('T1: Tier 2 context matching restores highlight when XPath breaks', async ({ page }) => {
    // Create an annotation — the component stores XPath + context fields
    await createAnnotation(page, 'quick brown fox', 'Context match test');
    await expectHighlightExists(page, 'quick brown fox');

    // Wait for persistence to disk
    await page.waitForTimeout(500);

    // Read the stored JSON and break the XPath so Tier 1 (XPath) fails,
    // forcing Tier 2 (context matching via contextBefore/contextAfter)
    const jsonData = readReviewJson();
    expect(jsonData).not.toBeNull();

    const annotations = (jsonData as Record<string, unknown>).annotations as Array<Record<string, unknown>>;
    expect(annotations.length).toBeGreaterThanOrEqual(1);

    // Corrupt the XPath inside annotation.range to a non-existent path —
    // text and context fields within range remain intact for Tier 2 fallback
    for (const annotation of annotations) {
      const range = annotation.range as Record<string, unknown> | undefined;
      if (range) {
        range.startXPath = '/html[1]/body[1]/div[99]/text()[1]';
        range.endXPath = '/html[1]/body[1]/div[99]/text()[1]';
      }
    }

    writeReviewJson(JSON.stringify(jsonData, null, 2));

    // Clear localStorage cache so the component fetches from the (modified) JSON file
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));

    // Reload — restoreHighlights should fail Tier 1, succeed Tier 2
    await page.reload();
    await waitForIntegration(page);

    // The highlight should still exist because context matching found the text
    await expectHighlightExists(page, 'quick brown fox');
  });

  test('T2: Tier 3 orphaned annotation visible in panel but not in DOM', async ({ page }) => {
    // Create an annotation that we will fully orphan
    await createAnnotation(page, 'quick brown fox', 'Orphan test');
    await expectHighlightExists(page, 'quick brown fox');

    // Wait for persistence to disk
    await page.waitForTimeout(500);

    // Read the stored JSON and break everything: XPath, selectedText, and context
    const jsonData = readReviewJson();
    expect(jsonData).not.toBeNull();

    const annotations = (jsonData as Record<string, unknown>).annotations as Array<Record<string, unknown>>;
    expect(annotations.length).toBeGreaterThanOrEqual(1);

    for (const annotation of annotations) {
      const range = annotation.range as Record<string, unknown> | undefined;
      if (range) {
        // Break Tier 1 (XPath)
        range.startXPath = '/html[1]/body[1]/div[99]/text()[1]';
        range.endXPath = '/html[1]/body[1]/div[99]/text()[1]';
        // Break Tier 2 (context matching) — change text and context to garbage
        range.selectedText = 'xyzzy nonexistent text';
        range.contextBefore = 'aaaa garbage context before aaaa';
        range.contextAfter = 'zzzz garbage context after zzzz';
      }
      // Also break top-level selectedText so panel shows orphaned text
      annotation.selectedText = 'xyzzy nonexistent text';
    }

    writeReviewJson(JSON.stringify(jsonData, null, 2));

    // Clear localStorage so the component fetches from the modified JSON
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));

    // Reload — both Tier 1 and Tier 2 fail, annotation becomes orphaned (Tier 3)
    await page.reload();
    await waitForIntegration(page);

    // No highlights should exist in the DOM (orphaned = no DOM highlight)
    await expectHighlightCount(page, 0);

    // But the annotation should still appear in the panel (rendered from server data)
    await openPanel(page);
    await expectAnnotationItemCount(page, 1);

    // The panel item should show the orphaned annotation's text
    const annotationItem = shadowLocator(page, SELECTORS.annotationItem).first();
    await expect(annotationItem).toBeVisible();
  });

  test('T3: FAB badge counts annotations only, not page notes', async ({ page }) => {
    // Create one annotation — badge should show 1
    await createAnnotation(page, 'quick brown fox', 'Badge count test');
    await expectBadgeCount(page, 1);

    // Add a page note — badge should still show 1 (not 2)
    await openPanel(page);
    await addPageNote(page, 'A page note');
    await closePanel(page);

    await expectBadgeCount(page, 1);

    // Create a second annotation — badge should show 2
    await createAnnotation(page, 'Software engineering', 'Second annotation');
    await expectBadgeCount(page, 2);
  });

  test('T4: Clear All confirmation auto-resets after 3 seconds', async ({ page }) => {
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

  test('T5: Page note cancel discards changes', async ({ page }) => {
    // Add a page note with known text
    await openPanel(page);
    await addPageNote(page, 'Original note text');

    // Verify the note was created
    await expectPageNoteCount(page, 1);

    // Click edit on the note
    const editBtn = shadowLocator(page, SELECTORS.pageNoteEdit).first();
    await editBtn.click();

    // Clear and type new text
    const textarea = shadowLocator(page, SELECTORS.pageNoteTextarea);
    await textarea.clear();
    await textarea.fill('Changed note text');

    // Click cancel instead of save
    const cancelBtn = shadowLocator(page, SELECTORS.pageNoteCancel);
    await cancelBtn.click();

    // Wait for panel to refresh
    await page.waitForTimeout(300);

    // Verify the original text is preserved — the edit was discarded
    const noteItem = shadowLocator(page, SELECTORS.pageNoteItem).first();
    await expect(noteItem).toContainText('Original note text');
    await expect(noteItem).not.toContainText('Changed note text');
  });
});
