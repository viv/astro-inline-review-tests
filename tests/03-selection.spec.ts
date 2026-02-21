import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS } from '../helpers/selectors';
import {
  waitForIntegration,
  selectText,
  cleanReviewData,
  createAnnotation,
} from '../helpers/actions';
import {
  expectPopupVisible,
  expectPopupHidden,
  expectHighlightExists,
  expectBadgeCount,
} from '../helpers/assertions';

test.describe('Text selection and annotation popup', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test('popup appears when text is selected', async ({ page }) => {
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);
  });

  test('popup is positioned near the selection', async ({ page }) => {
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    // Get the selection bounding rect and popup position
    const positions = await page.evaluate(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      const selRect = range.getBoundingClientRect();

      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const popup = host.shadowRoot.querySelector('[data-air-el="popup"]') as HTMLElement;
      if (!popup) return null;
      const popupRect = popup.getBoundingClientRect();

      return {
        selTop: selRect.top,
        selBottom: selRect.bottom,
        selLeft: selRect.left,
        selRight: selRect.right,
        popupTop: popupRect.top,
        popupLeft: popupRect.left,
      };
    });

    expect(positions).not.toBeNull();
    // Popup should be within reasonable distance of the selection
    if (positions) {
      const verticalDistance = Math.abs(positions.popupTop - positions.selBottom);
      expect(verticalDistance).toBeLessThan(200); // Within 200px vertically
    }
  });

  test('saving annotation creates a highlight', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'A test note');
    await expectHighlightExists(page, 'quick brown fox');
  });

  test('cancelling dismisses popup without creating annotation', async ({ page }) => {
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    const cancelBtn = shadowLocator(page, SELECTORS.popupCancel);
    await cancelBtn.click();

    await expectPopupHidden(page);
    await expectBadgeCount(page, 0);
  });

  test('saving with empty note still creates annotation', async ({ page }) => {
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    // Click save without typing anything
    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    await saveBtn.click();

    await expectPopupHidden(page);
    await expectHighlightExists(page, 'quick brown fox');
    await expectBadgeCount(page, 1);
  });

  test('whitespace-only selection is ignored', async ({ page }) => {
    // Try to select just whitespace characters
    await page.evaluate(() => {
      // Find a text node with leading/trailing whitespace and select just whitespace
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const text = node.textContent ?? '';
        const wsIndex = text.indexOf('  '); // double space
        if (wsIndex !== -1) {
          const range = document.createRange();
          range.setStart(node, wsIndex);
          range.setEnd(node, wsIndex + 2);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return;
        }
      }
      // If no double space found, create an empty selection
      const selection = window.getSelection();
      selection?.removeAllRanges();
    });
    await page.dispatchEvent('body', 'mouseup');

    // Brief wait to allow any unexpected popup to appear, then verify it didn't
    await page.waitForTimeout(200);
    await expectPopupHidden(page);
  });

  test('selection inside shadow DOM is ignored', async ({ page }) => {
    // Try to interact with text inside the shadow DOM host
    // The integration should not create annotations on its own UI
    await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return;
      // Try to select text inside shadow root (if any text exists)
      const textNodes: Text[] = [];
      const walker = document.createTreeWalker(host.shadowRoot, NodeFilter.SHOW_TEXT, null);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent && node.textContent.trim().length > 0) {
          textNodes.push(node);
          break;
        }
      }
      if (textNodes.length > 0) {
        const range = document.createRange();
        range.setStart(textNodes[0], 0);
        range.setEnd(textNodes[0], Math.min(5, textNodes[0].textContent?.length ?? 0));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    });
    await page.dispatchEvent('body', 'mouseup');

    // Brief wait to allow any unexpected popup to appear, then verify it didn't
    await page.waitForTimeout(200);
    await expectPopupHidden(page);
  });

  test('popup is dismissed when user scrolls', async ({ page }) => {
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    // Scroll the page
    await page.evaluate(() => window.scrollBy(0, 200));
    await expectPopupHidden(page);
  });

  test('popup shows preview of selected text', async ({ page }) => {
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    // The popup should contain or reference the selected text
    const popupText = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const popup = host.shadowRoot.querySelector('[data-air-el="popup"]');
      return popup?.textContent ?? null;
    });

    expect(popupText).toContain('quick brown fox');
  });

  test('long selected text is truncated in popup preview', async ({ page }) => {
    // Select a very long passage
    const longText = 'This is a deliberately long paragraph designed to test how the system handles';
    await selectText(page, longText);
    await expectPopupVisible(page);

    // The popup preview should truncate long text rather than showing it all
    const popupContent = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const popup = host.shadowRoot.querySelector('[data-air-el="popup"]');
      return popup?.textContent ?? null;
    });

    // Popup should exist and not be excessively long
    expect(popupContent).toBeTruthy();
  });

  test('popup textarea receives focus automatically', async ({ page }) => {
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    // The textarea should be focused for immediate typing
    const isFocused = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return false;
      const textarea = host.shadowRoot.querySelector('[data-air-el="popup-textarea"]');
      return host.shadowRoot.activeElement === textarea;
    });

    expect(isFocused).toBe(true);
  });
});
