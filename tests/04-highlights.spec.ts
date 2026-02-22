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
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
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

    // Wait for the full save round-trip (API POST + highlight application)
    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/__inline-review/api/annotations') &&
          resp.request().method() === 'POST' &&
          resp.ok(),
      ),
      saveBtn.click(),
    ]);
    await popup.waitFor({ state: 'hidden' });
    // Allow time for applyHighlight + fallback context matching
    await page.waitForTimeout(200);

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
      const textarea = host.shadowRoot.querySelector('[data-air-el="popup-textarea"]') as HTMLTextAreaElement;
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
      const ta = host.shadowRoot.querySelector('[data-air-el="popup-textarea"]') as HTMLTextAreaElement;
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
        host.shadowRoot.querySelector('[data-air-el="popup-delete"]') ||
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

  test('deleting a highlight merges adjacent text nodes', async ({ page }) => {
    // Count the text node children of #about-paragraph before any annotation
    const childNodeCountBefore = await page.evaluate(() => {
      const p = document.getElementById('about-paragraph');
      if (!p) return -1;
      return Array.from(p.childNodes).filter(
        (n) => n.nodeType === Node.TEXT_NODE,
      ).length;
    });

    // Create an annotation (inserts a <mark> that splits text nodes)
    await createAnnotation(page, 'quick brown fox', 'Normalise test');
    await expectHighlightCount(page, 1);

    // Verify the mark split text nodes (more child nodes now)
    const childNodeCountWithMark = await page.evaluate(() => {
      const p = document.getElementById('about-paragraph');
      if (!p) return -1;
      return p.childNodes.length;
    });
    expect(childNodeCountWithMark).toBeGreaterThan(childNodeCountBefore);

    // Delete the annotation via the edit popup
    const highlight = getHighlights(page).first();
    await highlight.click();
    await expectPopupVisible(page);

    const deleteResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/__inline-review/api/annotations') &&
        resp.request().method() === 'DELETE' &&
        resp.ok(),
    );

    await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return;
      const btn =
        host.shadowRoot.querySelector('[data-air-el="popup-delete"]') ||
        host.shadowRoot.querySelector('button[aria-label*="delete" i]');
      if (btn) (btn as HTMLElement).click();
    });

    await deleteResponsePromise;
    await expectHighlightCount(page, 0);

    // After deletion + normalize(), the paragraph should have the same
    // number of text node children as before the annotation was created
    const childNodeCountAfter = await page.evaluate(() => {
      const p = document.getElementById('about-paragraph');
      if (!p) return -1;
      return Array.from(p.childNodes).filter(
        (n) => n.nodeType === Node.TEXT_NODE,
      ).length;
    });

    expect(childNodeCountAfter).toBe(childNodeCountBefore);

    // And the full text content should be unchanged
    const textAfter = await page.locator('#about-paragraph').textContent();
    expect(textAfter).toContain('The quick brown fox jumps over the lazy dog');
  });

  test('selection spanning a <strong> boundary creates a valid annotation', async ({
    page,
  }) => {
    // Select text from plain text into the <strong> in #inline-elements-paragraph.
    // "paragraph contains" is unique to that paragraph; "bold text" is inside <strong>.
    await selectTextAcrossElements(page, 'paragraph contains', 'bold text');

    const popup = shadowLocator(page, SELECTORS.popup);
    await popup.waitFor({ state: 'visible' });

    const textarea = shadowLocator(page, SELECTORS.popupTextarea);
    await textarea.fill('Spans into strong');

    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/__inline-review/api/annotations') &&
          resp.request().method() === 'POST' &&
          resp.ok(),
      ),
      saveBtn.click(),
    ]);
    await popup.waitFor({ state: 'hidden' });
    await page.waitForTimeout(200);

    const highlightCount = await getHighlights(page).count();
    expect(highlightCount).toBeGreaterThanOrEqual(1);
    await expectBadgeCount(page, 1);

    // Verify the annotation persists across reload
    await page.reload();
    await waitForIntegration(page);
    await expectBadgeCount(page, 1);
  });

  test('selection spanning <em> and <a> elements creates a valid annotation', async ({
    page,
  }) => {
    await selectTextAcrossElements(page, 'italic text', 'hyperlink element');

    const popup = shadowLocator(page, SELECTORS.popup);
    await popup.waitFor({ state: 'visible' });

    const textarea = shadowLocator(page, SELECTORS.popupTextarea);
    await textarea.fill('Spans em and a');

    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/__inline-review/api/annotations') &&
          resp.request().method() === 'POST' &&
          resp.ok(),
      ),
      saveBtn.click(),
    ]);
    await popup.waitFor({ state: 'hidden' });
    await page.waitForTimeout(200);

    const highlightCount = await getHighlights(page).count();
    expect(highlightCount).toBeGreaterThanOrEqual(1);
    await expectBadgeCount(page, 1);
  });

  test('annotation within a single <strong> element works', async ({
    page,
  }) => {
    await selectText(page, 'bold text');

    const popup = shadowLocator(page, SELECTORS.popup);
    await popup.waitFor({ state: 'visible' });

    const textarea = shadowLocator(page, SELECTORS.popupTextarea);
    await textarea.fill('Inside strong only');

    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/__inline-review/api/annotations') &&
          resp.request().method() === 'POST' &&
          resp.ok(),
      ),
      saveBtn.click(),
    ]);
    await popup.waitFor({ state: 'hidden' });
    await page.waitForTimeout(100);

    await expectHighlightExists(page, 'bold text');
    await expectBadgeCount(page, 1);

    // Verify the highlight is inside the <strong> element
    const parentTag = await getHighlights(page)
      .first()
      .evaluate((el) => el.parentElement?.tagName.toLowerCase());
    expect(parentTag).toBe('strong');
  });
});
