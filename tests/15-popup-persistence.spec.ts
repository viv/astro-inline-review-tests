import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS, getHighlights } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  selectText,
  createAnnotation,
  altClickElement,
  readReviewStore,
  writeReviewStore,
  openPanel,
} from '../helpers/actions';
import {
  expectPopupVisible,
  expectPopupHidden,
  expectHighlightExists,
  expectHighlightCount,
  expectAnnotationOrphanIndicator,
} from '../helpers/assertions';

/**
 * Tests for popup state persistence across page reloads.
 *
 * When a user is typing an annotation note and a Vite HMR reload occurs
 * (e.g. agent edits source files), the popup and typed note should be
 * preserved. These tests verify the sessionStorage-based save/restore
 * mechanism and the store poller deferral behaviour.
 */

test.describe('Popup persistence across reloads', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('astro-inline-review');
      sessionStorage.removeItem('air-pending-popup');
      sessionStorage.removeItem('air-panel-state');
      sessionStorage.removeItem('air-scroll-to');
    });
    await waitForIntegration(page);
  });

  // ── Part 1: Text annotation popup persistence ──────────────────────

  test.describe('Text annotation popup persistence', () => {
    test('text popup with note restores after page reload', async ({ page }) => {
      // Select text and wait for popup
      await selectText(page, 'quick brown fox');
      const popup = shadowLocator(page, SELECTORS.popup);
      await popup.waitFor({ state: 'visible' });

      // Type a note
      const textarea = shadowLocator(page, SELECTORS.popupTextarea);
      await textarea.fill('My unsaved note about foxes');

      // Reload the page (simulates Vite HMR full reload)
      await page.reload();
      await waitForIntegration(page);

      // Popup should be restored with the typed note
      await expectPopupVisible(page);
      const restoredValue = await page.evaluate(() => {
        const host = document.getElementById('astro-inline-review-host');
        if (!host?.shadowRoot) return null;
        const ta = host.shadowRoot.querySelector('[data-air-el="popup-textarea"]') as HTMLTextAreaElement;
        return ta?.value ?? null;
      });

      expect(restoredValue).toBe('My unsaved note about foxes');
    });

    test('text popup with empty note restores after reload', async ({ page }) => {
      // Select text and wait for popup (don't type anything)
      await selectText(page, 'Software engineering');
      const popup = shadowLocator(page, SELECTORS.popup);
      await popup.waitFor({ state: 'visible' });

      // Reload
      await page.reload();
      await waitForIntegration(page);

      // Popup should be restored (even with empty note)
      await expectPopupVisible(page);
    });

    test('restored text popup can be saved successfully', async ({ page }) => {
      // Select text and type a note
      await selectText(page, 'quick brown fox');
      const popup = shadowLocator(page, SELECTORS.popup);
      await popup.waitFor({ state: 'visible' });

      const textarea = shadowLocator(page, SELECTORS.popupTextarea);
      await textarea.fill('Note from before reload');

      // Reload
      await page.reload();
      await waitForIntegration(page);

      // Popup should be restored
      await expectPopupVisible(page);

      // Save the restored annotation
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

      // Popup should dismiss
      await expectPopupHidden(page);

      // Annotation should be saved with the correct text and note
      const store = readReviewStore();
      expect(store).not.toBeNull();
      expect(store!.annotations.length).toBe(1);
      expect(store!.annotations[0].note).toBe('Note from before reload');
      expect(store!.annotations[0].selectedText).toContain('quick brown fox');
    });

    test('no popup restoration when popup was not active before reload', async ({ page }) => {
      // Just reload without any popup active
      await page.reload();
      await waitForIntegration(page);

      // No popup should appear
      await expectPopupHidden(page);
    });
  });

  // ── Part 2: Element annotation popup persistence ───────────────────

  test.describe('Element annotation popup persistence', () => {
    test('element popup with note restores after page reload', async ({ page }) => {
      // Alt+click an element
      await altClickElement(page, '#hero-section');
      const popup = shadowLocator(page, SELECTORS.popup);
      await popup.waitFor({ state: 'visible' });

      // Type a note
      const textarea = shadowLocator(page, SELECTORS.popupTextarea);
      await textarea.fill('Hero section needs redesign');

      // Reload
      await page.reload();
      await waitForIntegration(page);

      // Popup should be restored
      await expectPopupVisible(page);
      const restoredValue = await page.evaluate(() => {
        const host = document.getElementById('astro-inline-review-host');
        if (!host?.shadowRoot) return null;
        const ta = host.shadowRoot.querySelector('[data-air-el="popup-textarea"]') as HTMLTextAreaElement;
        return ta?.value ?? null;
      });

      expect(restoredValue).toBe('Hero section needs redesign');
    });

    test('restored element popup can be saved successfully', async ({ page }) => {
      // Alt+click and type a note
      await altClickElement(page, '#cta-button');
      const popup = shadowLocator(page, SELECTORS.popup);
      await popup.waitFor({ state: 'visible' });

      const textarea = shadowLocator(page, SELECTORS.popupTextarea);
      await textarea.fill('Button needs better styling');

      // Reload
      await page.reload();
      await waitForIntegration(page);

      // Save the restored annotation
      await expectPopupVisible(page);
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

      await expectPopupHidden(page);

      // Verify the saved annotation
      const store = readReviewStore();
      expect(store).not.toBeNull();
      expect(store!.annotations.length).toBe(1);
      expect(store!.annotations[0].type).toBe('element');
      expect(store!.annotations[0].note).toBe('Button needs better styling');
    });
  });

  // ── Part 3: Store poller deferral while popup is active ────────────

  test.describe('Store poller deferral', () => {
    test('panel shows status update while popup is active', async ({ page }) => {
      // Create an annotation first, then open a popup for a new annotation
      await createAnnotation(page, 'quick brown fox', 'First annotation');
      await expectHighlightExists(page, 'quick brown fox');

      // Open panel to see the annotation
      await openPanel(page);

      // Start a new annotation (popup is now open)
      await selectText(page, 'Software engineering');
      const popup = shadowLocator(page, SELECTORS.popup);
      await popup.waitFor({ state: 'visible' });

      // Simulate MCP addressing the first annotation by modifying the store file
      const store = readReviewStore();
      expect(store).not.toBeNull();
      store!.annotations[0].status = 'addressed';
      store!.annotations[0].addressedAt = new Date().toISOString();
      // Also bump updatedAt to change the fingerprint so the poller detects a change
      store!.annotations[0].updatedAt = new Date().toISOString();
      writeReviewStore(store! as { version: 1; annotations: Array<Record<string, unknown>>; pageNotes: Array<Record<string, unknown>> });

      // Wait for the store poller to detect the change (polls every 2s)
      // The panel should update to show "Addressed" even while popup is active
      const addressedBadge = shadowLocator(page, '[data-air-el="addressed-badge"]');
      await expect(addressedBadge).toBeVisible({ timeout: 10_000 });
      await expect(addressedBadge).toContainText('Addressed');

      // The popup should still be visible (not disrupted)
      await expectPopupVisible(page);
    });

    test('no false orphan indicators while popup is active and store changes', async ({ page }) => {
      // Create an annotation
      await createAnnotation(page, 'quick brown fox', 'Annotation to address');
      await expectHighlightExists(page, 'quick brown fox');

      // Open panel
      await openPanel(page);

      // Start a new annotation (popup active)
      await selectText(page, 'Software engineering');
      const popup = shadowLocator(page, SELECTORS.popup);
      await popup.waitFor({ state: 'visible' });

      // Simulate MCP setting in_progress then addressed
      const store = readReviewStore();
      expect(store).not.toBeNull();
      store!.annotations[0].status = 'in_progress';
      store!.annotations[0].inProgressAt = new Date().toISOString();
      store!.annotations[0].updatedAt = new Date().toISOString();
      writeReviewStore(store! as { version: 1; annotations: Array<Record<string, unknown>>; pageNotes: Array<Record<string, unknown>> });

      // Wait for poller to detect
      await page.waitForTimeout(3000);

      // Should have NO orphan indicators — the pendingStoreUpdate guard prevents
      // false orphan states while the popup is active
      await expectAnnotationOrphanIndicator(page, 0);

      // Popup should still be active
      await expectPopupVisible(page);
    });
  });

  // ── Part 4: Edge cases ─────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('sessionStorage is cleaned up after successful restore', async ({ page }) => {
      // Select text and type a note
      await selectText(page, 'quick brown fox');
      const popup = shadowLocator(page, SELECTORS.popup);
      await popup.waitFor({ state: 'visible' });

      const textarea = shadowLocator(page, SELECTORS.popupTextarea);
      await textarea.fill('Temp note');

      // Reload
      await page.reload();
      await waitForIntegration(page);

      // Popup should be restored
      await expectPopupVisible(page);

      // The sessionStorage key should have been cleaned up
      const pendingData = await page.evaluate(() =>
        sessionStorage.getItem('air-pending-popup'),
      );
      expect(pendingData).toBeNull();
    });

    test('corrupt sessionStorage data is handled gracefully', async ({ page }) => {
      // Write corrupt data to sessionStorage
      await page.evaluate(() => {
        sessionStorage.setItem('air-pending-popup', '{ this is not valid JSON }');
      });

      // Reload — should not crash
      await page.reload();
      await waitForIntegration(page);

      // No popup should appear (corrupt data discarded)
      await expectPopupHidden(page);

      // The corrupt key should be cleaned up
      const pendingData = await page.evaluate(() =>
        sessionStorage.getItem('air-pending-popup'),
      );
      expect(pendingData).toBeNull();
    });

    test('popup persistence does not interfere with normal annotation creation', async ({ page }) => {
      // Create an annotation normally (no reload involved)
      await createAnnotation(page, 'quick brown fox', 'Normal annotation');
      await expectHighlightExists(page, 'quick brown fox');
      await expectHighlightCount(page, 1);

      // Create another annotation — the first one should not be affected
      await createAnnotation(page, 'Software engineering', 'Second annotation');
      await expectHighlightCount(page, 2);

      // Reload and verify both persist
      await page.reload();
      await waitForIntegration(page);
      await expectHighlightCount(page, 2);
    });
  });
});
