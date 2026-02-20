import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS } from '../helpers/selectors';
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
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
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
      const noteItem = host.shadowRoot.querySelector('.air-page-note-item');
      return noteItem?.textContent ?? null;
    });

    expect(noteText).toContain('This is a page-level note about the home page');
  });

  test('edit existing page note', async ({ page }) => {
    await openPanel(page);
    await addPageNote(page, 'Original page note');
    await expectPageNoteCount(page, 1);

    // Click on the note to edit it
    const noteItem = shadowLocator(page, SELECTORS.pageNoteItem).first();
    await noteItem.click();

    // Should show edit UI
    const textarea = shadowLocator(page, SELECTORS.pageNoteTextarea);
    await textarea.clear();
    await textarea.fill('Edited page note');
    await textarea.press('Enter');

    // Verify the edit
    const noteText = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const noteItem = host.shadowRoot.querySelector('.air-page-note-item');
      return noteItem?.textContent ?? null;
    });

    expect(noteText).toContain('Edited page note');
  });

  test('delete page note', async ({ page }) => {
    await openPanel(page);
    await addPageNote(page, 'Note to delete');
    await expectPageNoteCount(page, 1);

    // Find and click delete on the page note
    await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return;
      const deleteBtn =
        host.shadowRoot.querySelector('.air-page-note-delete') ||
        host.shadowRoot.querySelector('.air-page-note-item [data-action="delete"]') ||
        host.shadowRoot.querySelector('.air-page-note-item button[aria-label*="delete" i]');
      if (deleteBtn) (deleteBtn as HTMLElement).click();
    });

    await page.waitForTimeout(300);
    await expectPageNoteCount(page, 0);
  });

  test('page note persists after reload', async ({ page }) => {
    await openPanel(page);
    await addPageNote(page, 'Persistent page note');

    await page.waitForTimeout(500);

    // Reload
    await page.reload();
    await waitForIntegration(page);

    await openPanel(page);
    await expectPageNoteCount(page, 1);

    const noteText = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return null;
      const noteItem = host.shadowRoot.querySelector('.air-page-note-item');
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
    await page.waitForTimeout(500);

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
    // Leave textarea empty and press Enter
    await textarea.press('Enter');

    await page.waitForTimeout(300);

    // Should not create a page note
    await expectPageNoteCount(page, 0);
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
      const panel = host.shadowRoot.querySelector('.air-panel');
      return panel?.textContent ?? null;
    });

    expect(panelContent).toContain('Home note in all pages');
    expect(panelContent).toContain('Second note in all pages');
  });
});
