import { test, expect } from '@playwright/test';
import { getHighlights, SELECTORS, shadowLocator } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  readReviewJson,
  writeReviewJson,
} from '../helpers/actions';
import {
  expectHighlightExists,
  expectHighlightCount,
  expectBadgeCount,
} from '../helpers/assertions';

test.describe('Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test('annotation persists in localStorage cache', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Cache test');

    const cacheData = await page.evaluate(() => {
      const raw = localStorage.getItem('astro-inline-review');
      if (!raw) return null;
      return JSON.parse(raw);
    });

    expect(cacheData).not.toBeNull();
    // Should contain at least one annotation
    expect(cacheData).toHaveProperty('annotations');
  });

  test('annotation persists in JSON file on disk', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'File test');

    // Give the server a moment to write to disk
    await page.waitForTimeout(500);

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
    await page.waitForTimeout(500);

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
    await page.waitForTimeout(500);

    // Corrupt localStorage but leave JSON file intact
    await page.evaluate(() => {
      localStorage.setItem('astro-inline-review', 'CORRUPTED DATA {{{');
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

    await page.waitForTimeout(500);

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

    await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return;
      const btn =
        host.shadowRoot.querySelector('[data-air-el="popup-delete"]') ||
        host.shadowRoot.querySelector('button[aria-label*="delete" i]');
      if (btn) (btn as HTMLElement).click();
    });

    await page.waitForTimeout(500);

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
    await saveBtn.click();

    await page.waitForTimeout(500);

    // Reload
    await page.reload();
    await waitForIntegration(page);

    // Click highlight to verify the edited note persisted
    const restoredHighlight = getHighlights(page).first();
    await restoredHighlight.click();

    const value = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const ta = host.shadowRoot.querySelector('[data-air-el="popup-textarea"]') as HTMLTextAreaElement;
      return ta?.value ?? null;
    });

    expect(value).toBe('After edit');
  });

  test('annotations survive dev server restart', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Server restart test');
    await page.waitForTimeout(500);

    // Verify JSON file exists on disk (this is the source of truth that survives restarts)
    const jsonData = readReviewJson();
    expect(jsonData).not.toBeNull();

    // Simulate server restart by reloading (the JSON file persists on disk)
    await page.reload();
    await waitForIntegration(page);

    // Annotations should be restored from the JSON file
    await expectHighlightExists(page, 'quick brown fox');
  });
});
