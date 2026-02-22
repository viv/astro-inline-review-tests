import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  selectText,
  openPanel,
  togglePanelShortcut,
  exportShortcut,
  pageNoteShortcut,
} from '../helpers/actions';
import {
  expectPanelOpen,
  expectPanelClosed,
  expectPopupVisible,
  expectPopupHidden,
} from '../helpers/assertions';

test.describe('Keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
  });

  test('Cmd/Ctrl+Shift+. toggles panel open and closed', async ({ page }) => {
    await expectPanelClosed(page);

    await togglePanelShortcut(page);
    await expectPanelOpen(page);

    await togglePanelShortcut(page);
    await expectPanelClosed(page);
  });

  test('Escape closes the panel', async ({ page }) => {
    await openPanel(page);
    await expectPanelOpen(page);

    await page.keyboard.press('Escape');
    await expectPanelClosed(page);
  });

  test('Escape dismisses popup (popup takes precedence over panel)', async ({ page }) => {
    await openPanel(page);
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    // Escape should dismiss popup first, not the panel
    await page.keyboard.press('Escape');

    await expectPopupHidden(page);
    // Panel should still be open
    await expectPanelOpen(page);
  });

  test('Cmd/Ctrl+Shift+E triggers export', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Shortcut export');

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Fire export shortcut and wait for the server GET to complete —
    // the shortcut handler fetches the full store from the server
    // before writing to the clipboard.
    await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/__inline-review/api/annotations') &&
          resp.request().method() === 'GET' &&
          !resp.url().includes('?page=') &&
          resp.ok(),
      ),
      exportShortcut(page),
    ]);

    // Poll clipboard — the clipboard write happens after the fetch resolves
    await expect.poll(
      () => page.evaluate(() => navigator.clipboard.readText()),
      { message: 'Clipboard should contain exported content', timeout: 5000 },
    ).toContain('quick brown fox');
  });

  test('Cmd/Ctrl+Shift+N opens page note input', async ({ page }) => {
    await pageNoteShortcut(page);

    // Should open the panel and focus the page note input.
    // The component's addPageNote handler is async (opens panel, awaits
    // a server fetch to refresh content, then clicks the + Note button).
    // The panel state attribute is set synchronously, but the textarea
    // only appears after the async refresh completes — so we must poll.
    await expectPanelOpen(page);

    await expect.poll(
      () =>
        page.evaluate(() => {
          const host = document.getElementById('astro-inline-review-host');
          if (!host?.shadowRoot) return false;
          return host.shadowRoot.querySelector('[data-air-el="page-note-textarea"]') !== null;
        }),
      { message: 'Page note textarea should appear after shortcut', timeout: 5000 },
    ).toBe(true);
  });

  test('shortcuts do not fire when typing in an input field', async ({ page }) => {
    // Create a temporary input field on the page
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'test-input';
      input.type = 'text';
      document.body.prepend(input);
    });

    // Focus the input
    await page.locator('#test-input').focus();

    // Try the panel toggle shortcut
    await togglePanelShortcut(page);

    // Panel should NOT open (shortcut suppressed in input)
    await expectPanelClosed(page);
  });

  test('shortcuts do not fire when typing in popup textarea', async ({ page }) => {
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    // Focus should be in the popup textarea
    // Try typing a shortcut — it should not toggle the panel
    const isMac = process.platform === 'darwin';
    const modKey = isMac ? 'Meta' : 'Control';

    // Press Cmd/Ctrl+Shift+. while in textarea — should NOT toggle panel
    await page.keyboard.press(`${modKey}+Shift+.`);

    // Panel should remain closed (shortcut suppressed in textarea)
    await expectPanelClosed(page);
  });

  test('Escape does not interfere with site own Escape handlers', async ({ page }) => {
    // When neither panel nor popup is open, Escape should not be captured
    await expectPanelClosed(page);
    await expectPopupHidden(page);

    // Add a custom Escape handler to the page
    await page.evaluate(() => {
      (window as unknown as Record<string, boolean>).__testEscapeFired = false;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          (window as unknown as Record<string, boolean>).__testEscapeFired = true;
        }
      });
    });

    await page.keyboard.press('Escape');

    // The site's own handler should have fired (event not captured)
    const escapeFired = await page.evaluate(
      () => (window as unknown as Record<string, boolean>).__testEscapeFired,
    );
    expect(escapeFired).toBe(true);
  });
});
