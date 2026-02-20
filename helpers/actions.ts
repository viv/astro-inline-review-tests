import { type Page } from '@playwright/test';
import { shadowLocator, SELECTORS } from './selectors';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Common actions for interacting with the inline review integration.
 * All interactions go through the browser — no source code imports.
 */

/** Path to the fixture's inline-review.json file */
const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixture');
const REVIEW_JSON_PATH = path.join(FIXTURE_DIR, 'inline-review.json');

/**
 * Clean up any persisted review data before a test.
 * Removes the inline-review.json file and clears localStorage.
 */
export async function cleanReviewData(page: Page): Promise<void> {
  // Remove JSON file if it exists
  try {
    fs.unlinkSync(REVIEW_JSON_PATH);
  } catch {
    // File doesn't exist — that's fine
  }

  // Clear localStorage for the review integration
  await page.evaluate(() => {
    localStorage.removeItem('astro-inline-review');
  });
}

/**
 * Select text on the page by finding a text node containing the target string
 * and creating a browser selection range over it.
 */
export async function selectText(page: Page, text: string): Promise<void> {
  await page.evaluate((targetText) => {
    // Walk text nodes in document body to find the target
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node: Text | null;

    while ((node = walker.nextNode() as Text | null)) {
      const index = node.textContent?.indexOf(targetText) ?? -1;
      if (index === -1) continue;

      // Skip nodes inside the shadow DOM host
      const host = document.getElementById('astro-inline-review-host');
      if (host?.contains(node)) continue;

      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + targetText.length);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }

    throw new Error(`Text not found in page: "${targetText}"`);
  }, text);

  // Trigger mouseup to simulate selection completion (the integration listens for this)
  await page.dispatchEvent('body', 'mouseup');
}

/**
 * Select text that spans across multiple elements.
 * Finds the start text in one node and end text in another.
 */
export async function selectTextAcrossElements(
  page: Page,
  startText: string,
  endText: string,
): Promise<void> {
  await page.evaluate(
    ({ start, end }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let startNode: Text | null = null;
      let startOffset = 0;
      let endNode: Text | null = null;
      let endOffset = 0;
      let node: Text | null;

      const host = document.getElementById('astro-inline-review-host');

      while ((node = walker.nextNode() as Text | null)) {
        if (host?.contains(node)) continue;

        if (!startNode) {
          const idx = node.textContent?.indexOf(start) ?? -1;
          if (idx !== -1) {
            startNode = node;
            startOffset = idx;
          }
        }

        const idx = node.textContent?.indexOf(end) ?? -1;
        if (idx !== -1) {
          endNode = node;
          endOffset = idx + end.length;
        }
      }

      if (!startNode || !endNode) {
        throw new Error(`Could not find text range: "${start}" to "${end}"`);
      }

      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    { start: startText, end: endText },
  );

  await page.dispatchEvent('body', 'mouseup');
}

/**
 * Click the FAB button (inside shadow DOM).
 */
export async function clickFab(page: Page): Promise<void> {
  const fab = shadowLocator(page, SELECTORS.fab);
  await fab.click();
}

/**
 * Open the review panel by clicking the FAB.
 * If the panel is already open, this is a no-op.
 */
export async function openPanel(page: Page): Promise<void> {
  const panel = shadowLocator(page, SELECTORS.panel);
  const isVisible = await panel.isVisible().catch(() => false);
  if (!isVisible) {
    await clickFab(page);
    await panel.waitFor({ state: 'visible' });
  }
}

/**
 * Close the review panel.
 * If the panel is already closed, this is a no-op.
 */
export async function closePanel(page: Page): Promise<void> {
  const panel = shadowLocator(page, SELECTORS.panel);
  const isVisible = await panel.isVisible().catch(() => false);
  if (isVisible) {
    await clickFab(page);
    await panel.waitFor({ state: 'hidden' });
  }
}

/**
 * Create an annotation: select text, wait for popup, type note, save.
 */
export async function createAnnotation(
  page: Page,
  text: string,
  note: string,
): Promise<void> {
  await selectText(page, text);

  // Wait for popup to appear
  const popup = shadowLocator(page, SELECTORS.popup);
  await popup.waitFor({ state: 'visible' });

  // Type the note
  const textarea = shadowLocator(page, SELECTORS.popupTextarea);
  await textarea.fill(note);

  // Click save
  const saveBtn = shadowLocator(page, SELECTORS.popupSave);
  await saveBtn.click();

  // Wait for popup to dismiss
  await popup.waitFor({ state: 'hidden' });
}

/**
 * Create an annotation with an empty note (just save without typing).
 */
export async function createAnnotationWithoutNote(page: Page, text: string): Promise<void> {
  await selectText(page, text);

  const popup = shadowLocator(page, SELECTORS.popup);
  await popup.waitFor({ state: 'visible' });

  const saveBtn = shadowLocator(page, SELECTORS.popupSave);
  await saveBtn.click();

  await popup.waitFor({ state: 'hidden' });
}

/**
 * Switch to a specific tab in the review panel.
 */
export async function switchPanelTab(page: Page, tab: 'this-page' | 'all-pages'): Promise<void> {
  const tabLocator = shadowLocator(
    page,
    tab === 'this-page' ? SELECTORS.tabThisPage : SELECTORS.tabAllPages,
  );
  await tabLocator.click();
}

/**
 * Add a page note via the panel.
 */
export async function addPageNote(page: Page, noteText: string): Promise<void> {
  await openPanel(page);

  const addBtn = shadowLocator(page, SELECTORS.pageNoteAdd);
  await addBtn.click();

  const textarea = shadowLocator(page, SELECTORS.pageNoteTextarea);
  await textarea.fill(noteText);

  // Save by pressing Enter or clicking save (implementation may vary)
  await textarea.press('Enter');
}

/**
 * Press a keyboard shortcut.
 */
export async function pressShortcut(
  page: Page,
  key: string,
  modifiers: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {},
): Promise<void> {
  const parts: string[] = [];
  if (modifiers.meta) parts.push('Meta');
  if (modifiers.ctrl) parts.push('Control');
  if (modifiers.shift) parts.push('Shift');
  parts.push(key);
  await page.keyboard.press(parts.join('+'));
}

/**
 * Toggle the panel with keyboard shortcut (Cmd/Ctrl+Shift+.).
 */
export async function togglePanelShortcut(page: Page): Promise<void> {
  const isMac = process.platform === 'darwin';
  await pressShortcut(page, '.', { meta: isMac, ctrl: !isMac, shift: true });
}

/**
 * Export with keyboard shortcut (Cmd/Ctrl+Shift+E).
 */
export async function exportShortcut(page: Page): Promise<void> {
  const isMac = process.platform === 'darwin';
  await pressShortcut(page, 'e', { meta: isMac, ctrl: !isMac, shift: true });
}

/**
 * Add page note with keyboard shortcut (Cmd/Ctrl+Shift+N).
 */
export async function pageNoteShortcut(page: Page): Promise<void> {
  const isMac = process.platform === 'darwin';
  await pressShortcut(page, 'n', { meta: isMac, ctrl: !isMac, shift: true });
}

/**
 * Read the inline-review.json file contents.
 * Returns null if the file doesn't exist.
 */
export function readReviewJson(): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(REVIEW_JSON_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Write arbitrary content to inline-review.json (for corruption tests).
 */
export function writeReviewJson(content: string): void {
  fs.writeFileSync(REVIEW_JSON_PATH, content, 'utf-8');
}

/**
 * Wait for the integration to be ready (shadow host exists).
 */
export async function waitForIntegration(page: Page): Promise<void> {
  await page.waitForSelector(`#astro-inline-review-host`, { timeout: 10_000 });
}

/**
 * Get the clipboard text content.
 */
export async function getClipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}
