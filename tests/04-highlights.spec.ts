import { test, expect } from '@playwright/test';
import { getHighlights, getHighlightById, SELECTORS, shadowLocator } from '../helpers/selectors';
import {
  waitForIntegration,
  selectText,
  cleanReviewData,
  createAnnotation,
  selectTextAcrossElements,
} from '../helpers/actions';
import {
  expectHighlightExists,
  expectHighlightNotExists,
  expectHighlightCount,
  expectPopupVisible,
  expectBadgeCount,
} from '../helpers/assertions';

test.describe('Highlights', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test('mark elements are created in the light DOM', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Test note');

    const highlights = getHighlights(page);
    await expect(highlights.first()).toBeAttached();

    // Verify it's a <mark> element in the light DOM (not shadow DOM)
    const tagName = await highlights.first().evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe('mark');
  });

  test('mark elements have data-air-id attribute', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Test note');

    const highlights = getHighlights(page);
    const airId = await highlights.first().getAttribute('data-air-id');
    expect(airId).toBeTruthy();
    expect(typeof airId).toBe('string');
  });

  test('mark elements have correct inline styles', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Test note');

    const highlights = getHighlights(page);
    const styles = await highlights.first().evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        backgroundColor: computed.backgroundColor,
        cursor: computed.cursor,
        borderRadius: computed.borderRadius,
      };
    });

    // Should have a visible background colour
    expect(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles.backgroundColor).not.toBe('transparent');

    // Should have pointer cursor (clickable)
    expect(styles.cursor).toBe('pointer');
  });

  test('cross-element selection creates multiple marks with same ID', async ({ page }) => {
    // Select text that spans across the two cross-element paragraphs
    await selectTextAcrossElements(
      page,
      'starts a thought that continues',
      'into this second paragraph',
    );

    const popup = shadowLocator(page, SELECTORS.popup);
    await popup.waitFor({ state: 'visible' });

    const textarea = shadowLocator(page, SELECTORS.popupTextarea);
    await textarea.fill('Cross-element note');

    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    await saveBtn.click();
    await popup.waitFor({ state: 'hidden' });

    // Should create multiple <mark> elements with the same data-air-id
    const highlights = getHighlights(page);
    const count = await highlights.count();
    expect(count).toBeGreaterThan(1);

    // All marks should share the same ID
    const ids = await highlights.evaluateAll((marks) =>
      marks.map((m) => m.getAttribute('data-air-id')),
    );
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(1);
  });

  test('clicking a mark opens edit popup', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Original note');

    const highlight = getHighlights(page).first();
    await highlight.click();

    await expectPopupVisible(page);

    // The popup should be pre-filled with the existing note
    const textareaValue = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const textarea = host.shadowRoot.querySelector('.air-popup textarea') as HTMLTextAreaElement;
      return textarea?.value ?? null;
    });

    expect(textareaValue).toBe('Original note');
  });

  test('editing updates the annotation note', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Original note');

    // Click highlight to edit
    const highlight = getHighlights(page).first();
    await highlight.click();
    await expectPopupVisible(page);

    // Clear and type new note
    const textarea = shadowLocator(page, SELECTORS.popupTextarea);
    await textarea.clear();
    await textarea.fill('Updated note');

    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    await saveBtn.click();

    // Verify the highlight still exists
    await expectHighlightExists(page, 'quick brown fox');

    // Click again to verify the note was updated
    await highlight.click();
    await expectPopupVisible(page);

    const updatedValue = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const ta = host.shadowRoot.querySelector('.air-popup textarea') as HTMLTextAreaElement;
      return ta?.value ?? null;
    });

    expect(updatedValue).toBe('Updated note');
  });

  test('deleting removes mark and annotation', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Note to delete');
    await expectHighlightCount(page, 1);
    await expectBadgeCount(page, 1);

    // Click highlight to open edit popup
    const highlight = getHighlights(page).first();
    await highlight.click();
    await expectPopupVisible(page);

    // Look for a delete button in the popup
    const deleteBtn = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return false;
      // Try common selectors for delete button
      const btn =
        host.shadowRoot.querySelector('.air-popup-delete') ||
        host.shadowRoot.querySelector('.air-popup [data-action="delete"]') ||
        host.shadowRoot.querySelector('button[aria-label*="delete" i]');
      if (btn) {
        (btn as HTMLElement).click();
        return true;
      }
      return false;
    });

    expect(deleteBtn).toBe(true);

    // Mark and annotation should be removed
    await expectHighlightCount(page, 0);
    await expectBadgeCount(page, 0);
  });

  test('marks do not break page layout', async ({ page }) => {
    // Get paragraph dimensions before annotation
    const beforeDimensions = await page.locator('#about-paragraph').boundingBox();

    await createAnnotation(page, 'quick brown fox', 'Layout test note');

    // Get paragraph dimensions after annotation
    const afterDimensions = await page.locator('#about-paragraph').boundingBox();

    // Paragraph dimensions should be approximately the same
    // (marks are inline elements and shouldn't change block flow)
    expect(beforeDimensions).not.toBeNull();
    expect(afterDimensions).not.toBeNull();
    if (beforeDimensions && afterDimensions) {
      expect(Math.abs(afterDimensions.height - beforeDimensions.height)).toBeLessThan(5);
      expect(afterDimensions.width).toBe(beforeDimensions.width);
    }
  });

  test('marks preserve surrounding whitespace', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Whitespace test');

    // The text around the highlight should remain properly spaced
    const parentText = await page.locator('#about-paragraph').textContent();
    expect(parentText).toContain('The quick brown fox jumps');
    // Should not have doubled spaces or missing spaces around the mark
    expect(parentText).not.toContain('The  quick');
    expect(parentText).not.toContain('fox  jumps');
    expect(parentText).not.toContain('Thequick');
    expect(parentText).not.toContain('foxjumps');
  });

  test('multiple annotations create independent highlights', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'First note');
    await createAnnotation(page, 'Software engineering', 'Second note');

    await expectHighlightCount(page, 2);

    // Each highlight should have a different data-air-id
    const ids = await getHighlights(page).evaluateAll((marks) =>
      marks.map((m) => m.getAttribute('data-air-id')),
    );
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(2);
  });
});
