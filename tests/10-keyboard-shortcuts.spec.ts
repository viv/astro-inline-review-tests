import { test, expect } from '@playwright/test';
import {
  waitForIntegration,
  cleanReviewData,
  selectText,
  openPanel,
  togglePanelShortcut,
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
    await page.evaluate(() => localStorage.removeItem('review-loop'));
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
