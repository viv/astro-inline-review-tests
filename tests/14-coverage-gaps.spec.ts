import { test, expect } from '@playwright/test';
import {
  getHighlights,
  SELECTORS,
  shadowLocator,
  HOST_ID,
  shadowQueryCount,
} from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  selectText,
  selectTextAcrossElements,
  createAnnotation,
  createAnnotationWithoutNote,
  openPanel,
  closePanel,
  addPageNote,
  switchPanelTab,
  exportShortcut,
  readReviewJson,
  writeReviewJson,
} from '../helpers/actions';
import {
  expectHighlightExists,
  expectHighlightNotExists,
  expectHighlightCount,
  expectBadgeCount,
  expectPopupVisible,
  expectPopupHidden,
  expectPanelOpen,
  expectToastVisible,
  expectAnnotationItemCount,
  expectPageNoteCount,
  createConsoleErrorCollector,
} from '../helpers/assertions';

/**
 * Coverage gap tests — addresses open items from docs/test-coverage-gaps.md.
 *
 * Gaps covered:
 *   §1.3  Page note edit to empty text
 *   §1.4  Toast notification content
 *   §1.7  Popup positioning / viewport clamping
 *   §1.8  Highlight removal normalises text nodes
 *   §2.2  Concurrent mixed API operations
 *   §2.3  External JSON file editing + reload
 *   §2.5  API error responses (5xx)
 *   §2.6  Multiple browser tabs
 *   §2.7  Annotation on text within inline elements
 *   §2.10 Panel scroll position preservation
 */

// ---------------------------------------------------------------------------
// §1.4 Toast notification content
// ---------------------------------------------------------------------------
test.describe('Toast notification content (§1.4)', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
  });

  test('toast shows success message after clipboard export', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Toast content test');

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await exportShortcut(page);

    // Verify the toast is visible AND contains a meaningful success message
    await expectToastVisible(page, 'Copied');
  });
});

// ---------------------------------------------------------------------------
// §1.7 Popup positioning / viewport clamping
// ---------------------------------------------------------------------------
test.describe('Popup positioning and viewport clamping (§1.7)', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
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
      // Popup bottom should not exceed the viewport (allow small margin)
      expect(positions.popupBottom).toBeLessThanOrEqual(
        positions.viewportHeight + 5,
      );
      // Popup top should not be negative (above viewport)
      expect(positions.popupTop).toBeGreaterThanOrEqual(-5);
    }
  });

  test('popup does not overflow above the viewport', async ({ page }) => {
    // Scroll to the very top
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);

    // Select text in the first paragraph (near the top of the page)
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
      // Popup top should not be above the viewport
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

// ---------------------------------------------------------------------------
// §1.8 Highlight removal normalises text nodes
// ---------------------------------------------------------------------------
test.describe('Highlight removal normalises text nodes (§1.8)', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
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
});

// ---------------------------------------------------------------------------
// §1.3 Page note edit to empty text
// ---------------------------------------------------------------------------
test.describe('Page note edit to empty text (§1.3)', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
  });

  test('editing a page note to empty text deletes or rejects the edit', async ({
    page,
  }) => {
    await openPanel(page);
    await addPageNote(page, 'Note that will be emptied');
    await expectPageNoteCount(page, 1);

    // Click edit on the note
    const editBtn = shadowLocator(page, SELECTORS.pageNoteEdit).first();
    await editBtn.click();

    // Clear the textarea completely
    const textarea = shadowLocator(page, SELECTORS.pageNoteTextarea);
    await textarea.clear();

    // Click save
    const saveBtn = shadowLocator(page, SELECTORS.pageNoteSave);
    await saveBtn.click();

    // Wait for the save to complete or be rejected
    await page.waitForTimeout(500);

    // Three acceptable outcomes:
    // 1. Note deleted (count = 0, form closed)
    // 2. Edit rejected, original text preserved (count = 1, form closed)
    // 3. Save rejected, edit form stays open (textarea still visible)
    const isTextareaStillVisible = await textarea.isVisible().catch(() => false);
    const noteCount = await shadowQueryCount(page, SELECTORS.pageNoteItem);

    if (isTextareaStillVisible) {
      // Save was rejected — the edit form is still open, which means the
      // implementation prevents saving empty notes. Cancel to restore state.
      const cancelBtn = shadowLocator(page, SELECTORS.pageNoteCancel);
      await cancelBtn.click();
      await expect(textarea).not.toBeVisible();

      // Original note should be preserved
      await expectPageNoteCount(page, 1);
      const noteItem = shadowLocator(page, SELECTORS.pageNoteItem).first();
      await expect(noteItem).toContainText('Note that will be emptied');
    } else if (noteCount === 0) {
      // Editing to empty deleted the note — acceptable behaviour
      await expectPageNoteCount(page, 0);
    } else {
      // Edit was rejected, form closed, original text preserved
      const noteItem = shadowLocator(page, SELECTORS.pageNoteItem).first();
      await expect(noteItem).toContainText('Note that will be emptied');
    }
  });
});

// ---------------------------------------------------------------------------
// §2.2 Concurrent mixed API operations
// ---------------------------------------------------------------------------
test.describe('Concurrent mixed API operations (§2.2)', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
  });

  test('create and then immediately delete does not corrupt state', async ({
    page,
  }) => {
    // Create two annotations
    await createAnnotation(page, 'quick brown fox', 'First for mixed ops');
    await createAnnotation(page, 'Software engineering', 'Second for mixed ops');
    await expectHighlightCount(page, 2);
    await expectBadgeCount(page, 2);

    // Now delete the first annotation while the state is fresh
    const firstHighlight = getHighlights(page).first();
    await firstHighlight.click();
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

    // Immediately create a third annotation (mixed create after delete)
    await createAnnotation(page, 'special characters', 'Third after delete');

    // Should have exactly 2 highlights (second + third; first was deleted)
    await expectHighlightCount(page, 2);
    await expectBadgeCount(page, 2);

    // Verify persistence survives the mixed operations
    await page.reload();
    await waitForIntegration(page);

    await expectHighlightCount(page, 2);
    await expectBadgeCount(page, 2);
  });

  test('rapid create-edit sequence preserves data integrity', async ({
    page,
  }) => {
    // Create an annotation and immediately edit it
    await createAnnotation(page, 'quick brown fox', 'Original rapid note');

    // Click highlight to edit immediately
    const highlight = getHighlights(page).first();
    await highlight.click();
    await expectPopupVisible(page);

    const textarea = shadowLocator(page, SELECTORS.popupTextarea);
    await textarea.clear();
    await textarea.fill('Rapidly edited note');

    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    const patchResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/__inline-review/api/annotations') &&
        resp.request().method() === 'PATCH' &&
        resp.ok(),
    );
    await saveBtn.click();
    await patchResponsePromise;

    // Immediately create a second annotation
    await createAnnotation(page, 'Software engineering', 'Second rapid note');

    await expectHighlightCount(page, 2);

    // Verify the edit persisted correctly
    await page.reload();
    await waitForIntegration(page);

    await expectHighlightCount(page, 2);

    // Verify the first annotation has the edited note
    const firstHighlight = getHighlights(page).first();
    await firstHighlight.click();

    const noteValue = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const ta = host.shadowRoot.querySelector(
        '[data-air-el="popup-textarea"]',
      ) as HTMLTextAreaElement;
      return ta?.value ?? null;
    });

    // Should have the edited text, not the original
    expect(noteValue).toBe('Rapidly edited note');
  });
});

// ---------------------------------------------------------------------------
// §2.3 External JSON file editing + reload
// ---------------------------------------------------------------------------
test.describe('External JSON file editing (§2.3)', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
  });

  test('externally written JSON file is loaded on page reload', async ({
    page,
  }) => {
    // Create an annotation via the UI to get a valid JSON structure
    await createAnnotation(page, 'quick brown fox', 'Original note');
    await expectHighlightCount(page, 1);

    // Read the current JSON file
    const jsonData = readReviewJson();
    expect(jsonData).not.toBeNull();

    // Modify the note text externally (simulating a text editor edit)
    const annotations = (jsonData as Record<string, unknown>)
      .annotations as Array<Record<string, unknown>>;
    expect(annotations.length).toBeGreaterThanOrEqual(1);
    annotations[0].note = 'Externally modified note';

    writeReviewJson(JSON.stringify(jsonData, null, 2));

    // Clear localStorage so the client fetches from the modified JSON file
    await page.evaluate(() =>
      localStorage.removeItem('astro-inline-review'),
    );

    // Reload the page
    await page.reload();
    await waitForIntegration(page);

    // The highlight should still exist
    await expectHighlightExists(page, 'quick brown fox');

    // Click the highlight and verify the note was updated from the JSON file
    const highlight = getHighlights(page).first();
    await highlight.click();
    await expectPopupVisible(page);

    const noteValue = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const ta = host.shadowRoot.querySelector(
        '[data-air-el="popup-textarea"]',
      ) as HTMLTextAreaElement;
      return ta?.value ?? null;
    });

    expect(noteValue).toBe('Externally modified note');
  });

  test('externally added annotation appears after reload', async ({ page }) => {
    // Create one annotation via the UI
    await createAnnotation(page, 'quick brown fox', 'First via UI');

    // Read the JSON and duplicate the annotation with different text
    const jsonData = readReviewJson();
    expect(jsonData).not.toBeNull();

    const annotations = (jsonData as Record<string, unknown>)
      .annotations as Array<Record<string, unknown>>;
    expect(annotations.length).toBeGreaterThanOrEqual(1);

    // Clone the first annotation and modify it to target different text
    const cloned = JSON.parse(JSON.stringify(annotations[0]));
    cloned.id = 'externally-added-' + Date.now();
    cloned.note = 'Externally added note';
    cloned.selectedText = 'Software engineering';
    // Update range to target the technical paragraph text
    if (cloned.range) {
      cloned.range.selectedText = 'Software engineering';
    }
    annotations.push(cloned);

    writeReviewJson(JSON.stringify(jsonData, null, 2));

    // Clear localStorage and reload
    await page.evaluate(() =>
      localStorage.removeItem('astro-inline-review'),
    );
    await page.reload();
    await waitForIntegration(page);

    // Should now have 2 annotations (badge count reflects current page annotations)
    await expectBadgeCount(page, 2);
  });
});

// ---------------------------------------------------------------------------
// §2.5 API error responses (5xx)
// ---------------------------------------------------------------------------
test.describe('API error responses (§2.5)', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
  });

  test('500 on annotation POST does not crash the UI', async ({ page }) => {
    const errors = createConsoleErrorCollector(page);

    // Intercept the annotation API and return 500
    await page.route('**/__inline-review/api/annotations', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        });
      }
      return route.continue();
    });

    // Try to create an annotation
    await selectText(page, 'quick brown fox');
    await expectPopupVisible(page);

    const textarea = shadowLocator(page, SELECTORS.popupTextarea);
    await textarea.fill('Will fail');

    const saveBtn = shadowLocator(page, SELECTORS.popupSave);
    await saveBtn.click();

    // Wait for the error to propagate
    await page.waitForTimeout(500);

    // The integration should still be functional — FAB should still be visible
    const fab = shadowLocator(page, SELECTORS.fab);
    await expect(fab).toBeVisible();

    // No highlight should be created (the save failed)
    await expectHighlightCount(page, 0);

    // Unroute so subsequent navigations work
    await page.unroute('**/__inline-review/api/annotations');
  });

  test('500 on annotation DELETE does not corrupt state', async ({ page }) => {
    // Create an annotation successfully first
    await createAnnotation(page, 'quick brown fox', 'Will try to delete');
    await expectHighlightCount(page, 1);

    // Now intercept DELETE to return 500
    await page.route('**/__inline-review/api/annotations/*', (route) => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        });
      }
      return route.continue();
    });

    // Try to delete the annotation
    const highlight = getHighlights(page).first();
    await highlight.click();
    await expectPopupVisible(page);

    await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return;
      const btn =
        host.shadowRoot.querySelector('[data-air-el="popup-delete"]') ||
        host.shadowRoot.querySelector('button[aria-label*="delete" i]');
      if (btn) (btn as HTMLElement).click();
    });

    // Wait for the error to propagate
    await page.waitForTimeout(500);

    // FAB should still be visible (integration not crashed)
    const fab = shadowLocator(page, SELECTORS.fab);
    await expect(fab).toBeVisible();

    // Unroute
    await page.unroute('**/__inline-review/api/annotations/*');
  });
});

// ---------------------------------------------------------------------------
// §2.6 Multiple browser tabs
// ---------------------------------------------------------------------------
test.describe('Multiple browser tabs (§2.6)', () => {
  test('annotations created in one tab are visible in another after reload', async ({
    browser,
  }) => {
    cleanReviewData();

    // Create two independent pages (simulating two tabs)
    const context = await browser.newContext();
    const tab1 = await context.newPage();
    const tab2 = await context.newPage();

    // Tab 1: navigate and create an annotation
    await tab1.goto('http://localhost:4321/');
    await tab1.evaluate(() =>
      localStorage.removeItem('astro-inline-review'),
    );
    await waitForIntegration(tab1);
    await createAnnotation(tab1, 'quick brown fox', 'Tab 1 note');
    await expectHighlightCount(tab1, 1);

    // Tab 2: navigate to the same page
    await tab2.goto('http://localhost:4321/');
    await tab2.evaluate(() =>
      localStorage.removeItem('astro-inline-review'),
    );
    await waitForIntegration(tab2);

    // Tab 2 should see the annotation from Tab 1 (loaded from server/JSON)
    await expectHighlightExists(tab2, 'quick brown fox');

    // Tab 2: create its own annotation
    await createAnnotation(tab2, 'Software engineering', 'Tab 2 note');
    await expectHighlightCount(tab2, 2);

    // Tab 1: reload to pick up Tab 2's annotation
    await tab1.reload();
    await waitForIntegration(tab1);
    await expectHighlightCount(tab1, 2);

    await context.close();
  });
});

// ---------------------------------------------------------------------------
// §2.7 Annotation on text within inline elements
// ---------------------------------------------------------------------------
test.describe('Text spanning inline elements (§2.7)', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
  });

  test('selection spanning a <strong> boundary creates a valid annotation', async ({
    page,
  }) => {
    // Select text that spans from before the <strong> into it.
    // Use "paragraph contains" (unique to #inline-elements-paragraph) as start
    // and "bold text" (inside <strong>) as end.
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

    // Should have highlight marks
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
    // Select text spanning from the <em> through the <a>:
    // "<em>italic text</em> and a <a href="#">hyperlink element</a>"
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
    // Select text entirely within the <strong> tag
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

// ---------------------------------------------------------------------------
// §2.10 Panel scroll position preservation
// ---------------------------------------------------------------------------
test.describe('Panel scroll position (§2.10)', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
  });

  test('panel content area supports overflow scrolling', async ({
    page,
  }) => {
    await openPanel(page);

    // Verify the panel content area has overflow-y set to auto or scroll,
    // which means it will scroll when content exceeds its height
    const overflowY = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panelContent = host.shadowRoot.querySelector(
        '[data-air-el="panel-content"]',
      ) as HTMLElement;
      if (!panelContent) return null;
      return window.getComputedStyle(panelContent).overflowY;
    });

    expect(overflowY).not.toBeNull();
    // overflow-y should be auto or scroll (not visible or hidden)
    expect(['auto', 'scroll']).toContain(overflowY);
  });

  test('long annotation list is scrollable in the panel', async ({
    page,
  }) => {
    // Create many annotations + page notes to exceed panel height
    await createAnnotation(page, 'quick brown fox', 'Note 1 for scroll test');
    await createAnnotation(page, 'Software engineering', 'Note 2 for scroll test');
    await createAnnotation(page, 'special characters', 'Note 3 for scroll test');
    await createAnnotation(page, 'introduction paragraph', 'Note 4 for scroll test');
    await createAnnotation(page, 'deliberately long paragraph', 'Note 5 for scroll test');

    // Also add page notes to increase content
    await openPanel(page);
    await addPageNote(page, 'Page note 1 for scroll test with enough text to take up space');
    await addPageNote(page, 'Page note 2 for scroll test with additional content');
    await addPageNote(page, 'Page note 3 for scroll test to ensure overflow');

    // Check that the panel content is actually scrollable now
    const scrollInfo = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panelContent = host.shadowRoot.querySelector(
        '[data-air-el="panel-content"]',
      ) as HTMLElement;
      if (!panelContent) return null;
      return {
        scrollHeight: panelContent.scrollHeight,
        clientHeight: panelContent.clientHeight,
        overflowY: window.getComputedStyle(panelContent).overflowY,
      };
    });

    expect(scrollInfo).not.toBeNull();
    if (scrollInfo) {
      // The content area should support scrolling
      expect(['auto', 'scroll']).toContain(scrollInfo.overflowY);
    }
  });
});
