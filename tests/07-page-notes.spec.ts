import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS, shadowQueryCount } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  openPanel,
  addPageNote,
  switchPanelTab,
} from '../helpers/actions';
import { expectPageNoteCount, expectPanelOpen } from '../helpers/assertions';

test.describe('Page notes', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
  });

  test('add page note via panel', async ({ page }) => {
    await openPanel(page);

    await addPageNote(page, 'This is a page-level note about the home page');

    await expectPageNoteCount(page, 1);

    // Verify the note text is visible in the panel
    const noteText = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const noteItem = host.shadowRoot.querySelector('[data-air-el="page-note-item"]');
      return noteItem?.textContent ?? null;
    });

    expect(noteText).toContain('This is a page-level note about the home page');
  });

  test('edit existing page note', async ({ page }) => {
    await openPanel(page);
    await addPageNote(page, 'Original page note');
    await expectPageNoteCount(page, 1);

    // Click the Edit button on the note
    const editBtn = shadowLocator(page, SELECTORS.pageNoteEdit).first();
    await editBtn.click();

    // Should show edit UI with textarea
    const textarea = shadowLocator(page, SELECTORS.pageNoteTextarea);
    await textarea.clear();
    await textarea.fill('Edited page note');

    // Click save
    const saveBtn = shadowLocator(page, SELECTORS.pageNoteSave);
    const patchResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/__inline-review/api/page-notes') &&
        resp.request().method() === 'PATCH' &&
        resp.ok(),
    );
    await saveBtn.click();
    await patchResponsePromise;

    // Wait for edit form to close (textarea replaced by rendered note)
    await expect(textarea).not.toBeVisible();

    // Verify the edit
    const noteText = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const noteItem = host.shadowRoot.querySelector('[data-air-el="page-note-item"]');
      return noteItem?.textContent ?? null;
    });

    expect(noteText).toContain('Edited page note');
  });

  test('delete page note', async ({ page }) => {
    await openPanel(page);
    await addPageNote(page, 'Note to delete');
    await expectPageNoteCount(page, 1);

    // Click delete button on the page note
    const deleteBtn = shadowLocator(page, SELECTORS.pageNoteDelete).first();
    const deleteResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/__inline-review/api/page-notes') &&
        resp.request().method() === 'DELETE' &&
        resp.ok(),
    );
    await deleteBtn.click();
    await deleteResponsePromise;
    await expectPageNoteCount(page, 0);
  });

  test('page note persists after reload', async ({ page }) => {
    await openPanel(page);
    await addPageNote(page, 'Persistent page note');

    // Reload
    await page.reload();
    await waitForIntegration(page);

    await openPanel(page);
    await expectPageNoteCount(page, 1);

    const noteText = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const noteItem = host.shadowRoot.querySelector('[data-air-el="page-note-item"]');
      return noteItem?.textContent ?? null;
    });

    expect(noteText).toContain('Persistent page note');
  });

  test('page note is scoped to current page URL', async ({ page }) => {
    await openPanel(page);
    await addPageNote(page, 'Home page note only');

    // Navigate to second page
    await page.goto('/second');
    await waitForIntegration(page);

    await openPanel(page);
    await switchPanelTab(page, 'this-page');

    // Should NOT show the home page note
    await expectPageNoteCount(page, 0);
  });

  test('page note appears in export', async ({ page }) => {
    await openPanel(page);
    await addPageNote(page, 'Note for export test');

    // Fetch export via API
    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    expect(exportContent).toContain('Note for export test');
    expect(exportContent).toContain('Page Notes');
  });

  test('multiple page notes per page', async ({ page }) => {
    await openPanel(page);
    await addPageNote(page, 'First page note');
    await addPageNote(page, 'Second page note');
    await addPageNote(page, 'Third page note');

    await expectPageNoteCount(page, 3);
  });

  test('empty note is not saved', async ({ page }) => {
    await openPanel(page);

    // Try to add an empty note
    const addBtn = shadowLocator(page, SELECTORS.pageNoteAdd);
    await addBtn.click();

    const textarea = shadowLocator(page, SELECTORS.pageNoteTextarea);
    // Leave textarea empty and click save
    const saveBtn = shadowLocator(page, SELECTORS.pageNoteSave);
    await saveBtn.click();

    // Empty note should not be saved — expectPageNoteCount auto-retries
    await expectPageNoteCount(page, 0);
  });

  test('cancel discards page note edit', async ({ page }) => {
    // Add a page note with known text
    await openPanel(page);
    await addPageNote(page, 'Original note text');

    // Verify the note was created
    await expectPageNoteCount(page, 1);

    // Click edit on the note
    const editBtn = shadowLocator(page, SELECTORS.pageNoteEdit).first();
    await editBtn.click();

    // Clear and type new text
    const textarea = shadowLocator(page, SELECTORS.pageNoteTextarea);
    await textarea.clear();
    await textarea.fill('Changed note text');

    // Click cancel instead of save
    const cancelBtn = shadowLocator(page, SELECTORS.pageNoteCancel);
    await cancelBtn.click();

    // Wait for edit form to close
    await expect(textarea).not.toBeVisible();

    // Verify the original text is preserved — the edit was discarded
    const noteItem = shadowLocator(page, SELECTORS.pageNoteItem).first();
    await expect(noteItem).toContainText('Original note text');
    await expect(noteItem).not.toContainText('Changed note text');
  });

  test('+ Note button toggles form visibility', async ({ page }) => {
    await openPanel(page);

    const addBtn = shadowLocator(page, SELECTORS.pageNoteAdd);
    const textarea = shadowLocator(page, SELECTORS.pageNoteTextarea);

    // Initially, the textarea should not be visible
    await expect(textarea).not.toBeVisible();

    // Click + Note — textarea should appear
    await addBtn.click();
    await expect(textarea).toBeVisible();

    // Click + Note again — textarea should disappear (toggle off)
    await addBtn.click();
    await expect(textarea).not.toBeVisible();

    // Click + Note a third time — textarea should appear again (toggle on)
    await addBtn.click();
    await expect(textarea).toBeVisible();
  });

  test('page note shows in All Pages view', async ({ page }) => {
    await openPanel(page);
    await addPageNote(page, 'Home note in all pages');

    await page.goto('/second');
    await waitForIntegration(page);
    await openPanel(page);
    await addPageNote(page, 'Second note in all pages');

    await switchPanelTab(page, 'all-pages');

    const panelContent = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const panel = host.shadowRoot.querySelector('[data-air-el="panel"]');
      return panel?.textContent ?? null;
    });

    expect(panelContent).toContain('Home note in all pages');
    expect(panelContent).toContain('Second note in all pages');
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
