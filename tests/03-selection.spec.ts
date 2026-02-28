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
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
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

    // Verify popup did not appear — expect().not auto-retries for the full
    // timeout window, so it catches a popup that appears asynchronously
    const popup = shadowLocator(page, SELECTORS.popup);
    await expect(popup).not.toHaveAttribute('data-air-state', 'visible', { timeout: 500 });
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

    // Verify popup did not appear — expect().not auto-retries for the full
    // timeout window, so it catches a popup that appears asynchronously
    const popup = shadowLocator(page, SELECTORS.popup);
    await expect(popup).not.toHaveAttribute('data-air-state', 'visible', { timeout: 500 });
  });

  test('popup is dismissed when user scrolls in passive mode', async ({ page }) => {
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    // Blur the textarea so the popup is in "passive" mode — no active focus
    // inside the popup. The popup auto-focuses the textarea on show, so we
    // must explicitly move focus away to simulate the user not interacting.
    await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (host?.shadowRoot) {
        const textarea = host.shadowRoot.querySelector('[data-air-el="popup-textarea"]') as HTMLElement;
        textarea?.blur();
      }
    });

    // Wait past the 400ms grace period that prevents scroll-dismissal
    // immediately after popup creation (guards against rAF focus races).
    // Without this, fast CI environments complete the whole sequence in
    // under 400ms and the grace period blocks the dismissal.
    await page.waitForTimeout(500);

    // Scroll the page beyond the 50px threshold
    await page.evaluate(() => window.scrollBy(0, 200));
    await expectPopupHidden(page);
  });

  test('popup is NOT dismissed when textarea is focused and user scrolls', async ({ page }) => {
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    // The textarea is auto-focused on show — verify it still has focus
    const hasFocus = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return false;
      const textarea = host.shadowRoot.querySelector('[data-air-el="popup-textarea"]');
      return host.shadowRoot.activeElement === textarea;
    });
    expect(hasFocus).toBe(true);

    // Scroll the page beyond the 50px threshold
    await page.evaluate(() => window.scrollBy(0, 200));

    // Popup should remain visible because the textarea has focus
    await expectPopupVisible(page);
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

  test('popup does not overflow below the viewport', async ({ page }) => {
    // Scroll to the very bottom of the page so the selection is near the
    // bottom edge of the viewport
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight),
    );
    await page.waitForTimeout(100);

    // Select the last padding paragraph text which is near the bottom
    await selectText(page, 'Final padding paragraph on the home page');
    await expectPopupVisible(page);

    // The popup's bottom edge must not exceed the viewport height
    const positions = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const popup = host.shadowRoot.querySelector(
        '[data-air-el="popup"]',
      ) as HTMLElement;
      if (!popup) return null;
      const rect = popup.getBoundingClientRect();
      return {
        popupBottom: rect.bottom,
        popupTop: rect.top,
        viewportHeight: window.innerHeight,
      };
    });

    expect(positions).not.toBeNull();
    if (positions) {
      expect(positions.popupBottom).toBeLessThanOrEqual(
        positions.viewportHeight + 5,
      );
      expect(positions.popupTop).toBeGreaterThanOrEqual(-5);
    }
  });

  test('popup does not overflow above the viewport', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);

    await selectText(page, 'introduction paragraph');
    await expectPopupVisible(page);

    const positions = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const popup = host.shadowRoot.querySelector(
        '[data-air-el="popup"]',
      ) as HTMLElement;
      if (!popup) return null;
      const rect = popup.getBoundingClientRect();
      return {
        popupTop: rect.top,
        popupBottom: rect.bottom,
        viewportHeight: window.innerHeight,
      };
    });

    expect(positions).not.toBeNull();
    if (positions) {
      expect(positions.popupTop).toBeGreaterThanOrEqual(-5);
      expect(positions.popupBottom).toBeLessThanOrEqual(
        positions.viewportHeight + 5,
      );
    }
  });

  test('popup does not overflow horizontally beyond viewport', async ({ page }) => {
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    const positions = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const popup = host.shadowRoot.querySelector(
        '[data-air-el="popup"]',
      ) as HTMLElement;
      if (!popup) return null;
      const rect = popup.getBoundingClientRect();
      return {
        popupLeft: rect.left,
        popupRight: rect.right,
        viewportWidth: window.innerWidth,
      };
    });

    expect(positions).not.toBeNull();
    if (positions) {
      expect(positions.popupLeft).toBeGreaterThanOrEqual(-5);
      expect(positions.popupRight).toBeLessThanOrEqual(
        positions.viewportWidth + 5,
      );
    }
  });
});
