import { test, expect } from '@playwright/test';
import { getHighlights, SELECTORS, shadowLocator } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  openPanel,
  readReviewJson,
  writeReviewJson,
} from '../helpers/actions';
import {
  expectHighlightExists,
  expectHighlightCount,
  expectBadgeCount,
  expectAnnotationItemCount,
  expectPopupVisible,
} from '../helpers/assertions';

test.describe('Persistence', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('review-loop'));
    await waitForIntegration(page);
  });

  test('annotation persists in localStorage cache', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Cache test');

    const cacheData = await page.evaluate(() => {
      const raw = localStorage.getItem('review-loop');
      if (!raw) return null;
      return JSON.parse(raw);
    });

    expect(cacheData).not.toBeNull();
    // Should contain at least one annotation
    expect(cacheData).toHaveProperty('annotations');
  });

  test('annotation persists in JSON file on disk', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'File test');

    const jsonData = readReviewJson();
    expect(jsonData).not.toBeNull();
    expect(jsonData).toHaveProperty('annotations');

    // Should contain our annotation
    const annotations = (jsonData as Record<string, unknown>).annotations as unknown[];
    expect(annotations.length).toBeGreaterThanOrEqual(1);
  });

  test('reload restores highlights from persisted data', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Reload test');
    await expectHighlightExists(page, 'quick brown fox');

    // Reload the page
    await page.reload();
    await waitForIntegration(page);

    // Highlights should be restored
    await expectHighlightExists(page, 'quick brown fox');
  });

  test('reload restores correct badge count', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Badge test 1');
    await createAnnotation(page, 'Software engineering', 'Badge test 2');
    await expectBadgeCount(page, 2);

    // Reload the page
    await page.reload();
    await waitForIntegration(page);

    // Badge count should be restored
    await expectBadgeCount(page, 2);
  });

  test('JSON file corruption results in graceful empty state', async ({ page }) => {
    // Create an annotation first
    await createAnnotation(page, 'quick brown fox', 'Corruption test');

    // Corrupt the JSON file
    writeReviewJson('{ this is not valid JSON!!!');

    // Reload — should handle corruption gracefully
    await page.reload();
    await waitForIntegration(page);

    // Should start fresh without errors (no highlights from corrupted data)
    await expectHighlightCount(page, 0);
    await expectBadgeCount(page, 0);
  });

  test('localStorage corruption falls back to API', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Fallback test');

    // Corrupt localStorage but leave JSON file intact
    await page.evaluate(() => {
      localStorage.setItem('review-loop', 'CORRUPTED DATA {{{');
    });

    // Reload — should fall back to server API
    await page.reload();
    await waitForIntegration(page);

    // Should restore from server data
    await expectHighlightExists(page, 'quick brown fox');
  });

  test('multiple annotations all persist correctly', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Note one');
    await createAnnotation(page, 'Software engineering', 'Note two');
    await createAnnotation(page, 'special characters', 'Note three');

    // Reload
    await page.reload();
    await waitForIntegration(page);

    // All three should be restored
    await expectHighlightCount(page, 3);
    await expectBadgeCount(page, 3);
  });

  test('delete persists after reload', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Delete persistence test');
    await expectHighlightCount(page, 1);

    // Delete via edit popup
    const highlight = getHighlights(page).first();
    await highlight.click();

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

    // Reload
    await page.reload();
    await waitForIntegration(page);

    // Should still be deleted
    await expectHighlightCount(page, 0);
    await expectBadgeCount(page, 0);
  });

  test('edit persists after reload', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Before edit');

    // Edit the annotation
    const highlight = getHighlights(page).first();
    await highlight.click();

    const textarea = shadowLocator(page, SELECTORS.popupTextarea);
    await textarea.clear();
    await textarea.fill('After edit');

    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    const patchResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/__inline-review/api/annotations') &&
        resp.request().method() === 'PATCH' &&
        resp.ok(),
    );
    await saveBtn.click();
    await patchResponsePromise;

    // Reload
    await page.reload();
    await waitForIntegration(page);

    // Click highlight to verify the edited note persisted
    const restoredHighlight = getHighlights(page).first();
    await restoredHighlight.click();

    const value = await page.evaluate(() => {
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const ta = host.shadowRoot.querySelector('[data-air-el="popup-textarea"]') as HTMLTextAreaElement;
      return ta?.value ?? null;
    });

    expect(value).toBe('After edit');
  });

  test('context matching restores highlight when XPath breaks (Tier 2)', async ({ page }) => {
    // Create an annotation — the component stores XPath + context fields
    await createAnnotation(page, 'quick brown fox', 'Context match test');
    await expectHighlightExists(page, 'quick brown fox');

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
    await page.evaluate(() => localStorage.removeItem('review-loop'));

    // Reload — restoreHighlights should fail Tier 1, succeed Tier 2
    await page.reload();
    await waitForIntegration(page);

    // The highlight should still exist because context matching found the text
    await expectHighlightExists(page, 'quick brown fox');
  });

  test('orphaned annotation visible in panel but not in DOM (Tier 3)', async ({ page }) => {
    // Create an annotation that we will fully orphan
    await createAnnotation(page, 'quick brown fox', 'Orphan test');
    await expectHighlightExists(page, 'quick brown fox');

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
    await page.evaluate(() => localStorage.removeItem('review-loop'));

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

  test('invalid JSON schema recovery — wrong version resets to empty store', async ({ page }) => {
    // Create an annotation first so there is data to lose
    await createAnnotation(page, 'quick brown fox', 'Schema test note');

    // Write valid JSON but with an invalid schema (wrong version + wrong shape)
    writeReviewJson(JSON.stringify({ version: 2, data: 'wrong shape' }));

    // Also clear localStorage so the client can't fall back to cache
    await page.evaluate(() => localStorage.removeItem('review-loop'));

    // Reload — server should reject the invalid schema and return an empty store
    await page.reload();
    await waitForIntegration(page);

    // No highlights should be present (data was discarded)
    await expectHighlightCount(page, 0);
    await expectBadgeCount(page, 0);
  });

  test('annotations survive dev server restart', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Server restart test');

    // Verify JSON file exists on disk (this is the source of truth that survives restarts)
    const jsonData = readReviewJson();
    expect(jsonData).not.toBeNull();

    // Simulate server restart by reloading (the JSON file persists on disk)
    await page.reload();
    await waitForIntegration(page);

    // Annotations should be restored from the JSON file
    await expectHighlightExists(page, 'quick brown fox');
  });

  test('externally written JSON file is loaded on page reload', async ({
    page,
  }) => {
    // Create an annotation via the UI to get a valid JSON structure
    await createAnnotation(page, 'quick brown fox', 'Original note');
    await expectHighlightCount(page, 1);

    // Read the current JSON file
    const jsonData = readReviewJson();
    expect(jsonData).not.toBeNull();

    // Modify the note text externally (simulating a text editor edit)
    const annotations = (jsonData as Record<string, unknown>)
      .annotations as Array<Record<string, unknown>>;
    expect(annotations.length).toBeGreaterThanOrEqual(1);
    annotations[0].note = 'Externally modified note';

    writeReviewJson(JSON.stringify(jsonData, null, 2));

    // Clear localStorage so the client fetches from the modified JSON file
    await page.evaluate(() =>
      localStorage.removeItem('review-loop'),
    );

    // Reload the page
    await page.reload();
    await waitForIntegration(page);

    // The highlight should still exist
    await expectHighlightExists(page, 'quick brown fox');

    // Click the highlight and verify the note was updated from the JSON file
    const highlight = getHighlights(page).first();
    await highlight.click();
    await expectPopupVisible(page);

    const noteValue = await page.evaluate(() => {
      const host = document.getElementById('review-loop-host');
      if (!host?.shadowRoot) return null;
      const ta = host.shadowRoot.querySelector(
        '[data-air-el="popup-textarea"]',
      ) as HTMLTextAreaElement;
      return ta?.value ?? null;
    });

    expect(noteValue).toBe('Externally modified note');
  });

  test('externally added annotation appears after reload', async ({ page }) => {
    // Create one annotation via the UI
    await createAnnotation(page, 'quick brown fox', 'First via UI');

    // Read the JSON and duplicate the annotation with different text
    const jsonData = readReviewJson();
    expect(jsonData).not.toBeNull();

    const annotations = (jsonData as Record<string, unknown>)
      .annotations as Array<Record<string, unknown>>;
    expect(annotations.length).toBeGreaterThanOrEqual(1);

    // Clone the first annotation and modify it to target different text
    const cloned = JSON.parse(JSON.stringify(annotations[0]));
    cloned.id = 'externally-added-' + Date.now();
    cloned.note = 'Externally added note';
    cloned.selectedText = 'Software engineering';
    if (cloned.range) {
      cloned.range.selectedText = 'Software engineering';
    }
    annotations.push(cloned);

    writeReviewJson(JSON.stringify(jsonData, null, 2));

    // Clear localStorage and reload
    await page.evaluate(() =>
      localStorage.removeItem('review-loop'),
    );
    await page.reload();
    await waitForIntegration(page);

    // Should now have 2 annotations
    await expectBadgeCount(page, 2);
  });

  test('annotations created in one tab are visible in another after reload', async ({
    browser,
  }) => {
    cleanReviewData();

    // Create two independent pages (simulating two tabs)
    const context = await browser.newContext();
    const tab1 = await context.newPage();
    const tab2 = await context.newPage();

    // Tab 1: navigate and create an annotation
    await tab1.goto('http://localhost:4399/');
    await tab1.evaluate(() =>
      localStorage.removeItem('review-loop'),
    );
    await waitForIntegration(tab1);
    await createAnnotation(tab1, 'quick brown fox', 'Tab 1 note');
    await expectHighlightCount(tab1, 1);

    // Tab 2: navigate to the same page
    await tab2.goto('http://localhost:4399/');
    await tab2.evaluate(() =>
      localStorage.removeItem('review-loop'),
    );
    await waitForIntegration(tab2);

    // Tab 2 should see the annotation from Tab 1 (loaded from server/JSON)
    await expectHighlightExists(tab2, 'quick brown fox');

    // Tab 2: create its own annotation
    await createAnnotation(tab2, 'Software engineering', 'Tab 2 note');
    await expectHighlightCount(tab2, 2);

    // Tab 1: reload to pick up Tab 2's annotation
    await tab1.reload();
    await waitForIntegration(tab1);
    await expectHighlightCount(tab1, 2);

    await context.close();
  });
});
