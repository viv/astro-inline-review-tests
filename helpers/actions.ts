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
 * Removes the inline-review.json file (Node-side only — no page needed).
 * localStorage is cleared separately after navigation to avoid a double
 * page load in beforeEach hooks.
 */
export function cleanReviewData(): void {
  try {
    fs.unlinkSync(REVIEW_JSON_PATH);
  } catch {
    // File doesn't exist — that's fine
  }
}

/**
 * Select text on the page by finding a text node containing the target string
 * and creating a browser selection range over it.
 */
export async function selectText(page: Page, text: string): Promise<void> {
  await page.evaluate((targetText) => {
    // Normalise whitespace for matching (DOM textContent preserves source newlines/indentation)
    const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
    const normTarget = normalise(targetText);

    // Walk text nodes in document body to find the target
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node: Text | null;

    while ((node = walker.nextNode() as Text | null)) {
      const rawContent = node.textContent ?? '';

      // Skip nodes inside the shadow DOM host
      const host = document.getElementById('astro-inline-review-host');
      if (host?.contains(node)) continue;

      // Try exact match first, then normalised match
      let index = rawContent.indexOf(targetText);
      let endIndex = index + targetText.length;

      if (index === -1) {
        // Build a mapping from normalised positions back to raw positions
        const normContent = normalise(rawContent);
        const normIdx = normContent.indexOf(normTarget);
        if (normIdx === -1) continue;

        // Map normalised index back to raw content positions
        let rawPos = 0;
        let normPos = 0;
        // Skip leading whitespace
        while (rawPos < rawContent.length && /\s/.test(rawContent[rawPos])) rawPos++;

        let startRaw = -1;
        let endRaw = -1;

        for (; rawPos <= rawContent.length && normPos <= normContent.length; rawPos++) {
          if (normPos === normIdx && startRaw === -1) startRaw = rawPos;
          if (normPos === normIdx + normTarget.length && endRaw === -1) {
            endRaw = rawPos;
            break;
          }
          if (rawPos < rawContent.length) {
            if (/\s/.test(rawContent[rawPos])) {
              // Skip consecutive whitespace in raw, but only advance normPos by 1
              while (rawPos + 1 < rawContent.length && /\s/.test(rawContent[rawPos + 1])) rawPos++;
              normPos++;
            } else {
              normPos++;
            }
          }
        }

        if (startRaw === -1 || endRaw === -1) continue;
        index = startRaw;
        endIndex = endRaw;
      }

      // Scroll the target element into view if it's offscreen
      const parent = node.parentElement;
      if (parent) {
        const rect = parent.getBoundingClientRect();
        const isOffscreen = rect.bottom < 0 || rect.top > window.innerHeight;
        if (isOffscreen) {
          parent.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      }

      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, endIndex);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }

    throw new Error(`Text not found in page: "${targetText}"`);
  }, text);

  // Wait for scroll events to settle (scrollIntoView fires async scroll events
  // that would hide the popup if they arrive after the popup is shown)
  await page.waitForTimeout(100);

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

      // Scroll the start element into view if offscreen
      const parent = startNode.parentElement;
      if (parent) {
        const rect = parent.getBoundingClientRect();
        const isOffscreen = rect.bottom < 0 || rect.top > window.innerHeight;
        if (isOffscreen) {
          parent.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
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

  // Wait for scroll events to settle (same as selectText)
  await page.waitForTimeout(100);

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
 * Waits for the full save round-trip (API POST + highlight application)
 * before returning, so the next test step sees the highlight in the DOM.
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

  // Click save and wait for the API POST to complete — the popup hides
  // before the API call finishes, so waiting for popup hidden alone is
  // not enough to guarantee the highlight has been applied.
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

  // Wait for popup to dismiss
  await popup.waitFor({ state: 'hidden' });

  // Allow one tick for applyHighlight (synchronous, runs after API response)
  await page.waitForTimeout(50);
}

/**
 * Create an annotation with an empty note (just save without typing).
 */
export async function createAnnotationWithoutNote(page: Page, text: string): Promise<void> {
  await selectText(page, text);

  const popup = shadowLocator(page, SELECTORS.popup);
  await popup.waitFor({ state: 'visible' });

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
  await page.waitForTimeout(50);
}

/**
 * Switch to a specific tab in the review panel.
 * Waits for the tab's content to load (the All Pages tab fetches from the server).
 */
export async function switchPanelTab(page: Page, tab: 'this-page' | 'all-pages'): Promise<void> {
  const tabLocator = shadowLocator(
    page,
    tab === 'this-page' ? SELECTORS.tabThisPage : SELECTORS.tabAllPages,
  );
  await tabLocator.click();

  // The All Pages tab fetches data from the server asynchronously.
  // Wait for content to render — either annotation items, page note items,
  // or an empty state message.
  await page.waitForFunction(() => {
    const host = document.getElementById('astro-inline-review-host');
    if (!host?.shadowRoot) return false;
    const content = host.shadowRoot.querySelector('[data-air-el="panel-content"]');
    if (!content) return false;
    // Content is loaded when it has child elements (annotation items, page note items, or empty state)
    return content.children.length > 0;
  }, { timeout: 5000 });
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

  // Click save and wait for the API POST to complete
  const saveBtn = shadowLocator(page, SELECTORS.pageNoteSave);
  await Promise.all([
    page.waitForResponse(
      (resp) =>
        resp.url().includes('/__inline-review/api/page-notes') &&
        resp.request().method() === 'POST' &&
        resp.ok(),
    ),
    saveBtn.click(),
  ]);

  // Wait for the panel to process the response and refresh (form is removed,
  // page note item appears)
  await textarea.waitFor({ state: 'detached' });
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
  // The host div is zero-dimensional (all UI is position:fixed inside shadow root),
  // so we wait for it to be attached to the DOM rather than visible.
  await page.waitForSelector(`#astro-inline-review-host`, { state: 'attached', timeout: 10_000 });
  // Also wait for the FAB to be visible — confirms the client script has fully initialised.
  await page.locator('#astro-inline-review-host').locator('[data-air-el="fab"]').waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * Get the clipboard text content.
 */
export async function getClipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/**
 * Hold the Alt key down (activates inspector mode).
 */
export async function holdAlt(page: Page): Promise<void> {
  await page.keyboard.down('Alt');
}

/**
 * Release the Alt key (deactivates inspector mode).
 */
export async function releaseAlt(page: Page): Promise<void> {
  await page.keyboard.up('Alt');
}

/**
 * Alt+click an element to create an element annotation.
 * Pre-scrolls into view and waits for scroll events to settle
 * (mirrors selectText's approach — scrollIntoView fires async scroll
 * events that would hide the popup if they arrive after it's shown).
 */
export async function altClickElement(page: Page, selector: string): Promise<void> {
  // Scroll element into view first (use .first() to avoid strict mode
  // violation when selector matches multiple elements — page.click()
  // already resolves to the first match)
  await page.locator(selector).first().scrollIntoViewIfNeeded();

  // Wait for scroll events to settle (same pattern as selectText)
  await page.waitForTimeout(100);

  // Now Alt+click — element is already in view, so no additional scroll
  await page.keyboard.down('Alt');
  await page.click(selector, { modifiers: ['Alt'] });
  await page.keyboard.up('Alt');
}

/**
 * Create an element annotation: Alt+click element, wait for popup, type note, save.
 * Waits for the full save round-trip before returning.
 */
export async function createElementAnnotation(
  page: Page,
  elementSelector: string,
  note: string,
): Promise<void> {
  await altClickElement(page, elementSelector);

  // Wait for popup to appear
  const popup = shadowLocator(page, SELECTORS.popup);
  await popup.waitFor({ state: 'visible' });

  // Type the note
  const textarea = shadowLocator(page, SELECTORS.popupTextarea);
  await textarea.fill(note);

  // Click save and wait for API POST
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

  // Wait for popup to dismiss
  await popup.waitFor({ state: 'hidden' });

  // Allow one tick for highlight application
  await page.waitForTimeout(50);
}
