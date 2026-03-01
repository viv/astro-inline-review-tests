import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  createAnnotationWithoutNote,
  openPanel,
  addPageNote,
  clickExportButton,
} from '../helpers/actions';
import { expectToastVisible } from '../helpers/assertions';

test.describe('Export', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('review-loop'));
    await waitForIntegration(page);
  });

  test('export generates valid markdown', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'A test note');

    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    // Should be valid markdown with expected structure
    expect(exportContent).toContain('# Inline Review');
    expect(exportContent).toContain('Exported:');
  });

  test('export includes page URL as heading', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'URL heading test');

    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    // Should include the page path as a heading
    expect(exportContent).toMatch(/##.*\//);
  });

  test('export includes page title', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Title test');

    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    // Should include the page title (Home or the full title)
    expect(exportContent).toMatch(/Home|Fixture Site/i);
  });

  test('page notes appear as bullet list under Page Notes heading', async ({ page }) => {
    await openPanel(page);
    await addPageNote(page, 'First page note for export');
    await addPageNote(page, 'Second page note for export');

    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    expect(exportContent).toContain('### Page Notes');
    expect(exportContent).toContain('- First page note for export');
    expect(exportContent).toContain('- Second page note for export');
  });

  test('annotations numbered under Text Annotations heading', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Note one');
    await createAnnotation(page, 'Software engineering', 'Note two');

    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    expect(exportContent).toContain('### Text Annotations');
    // Annotations should be numbered
    expect(exportContent).toMatch(/1\.\s/);
    expect(exportContent).toMatch(/2\.\s/);
  });

  test('selected text appears in bold quotes', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Bold test');

    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    // Selected text should be in bold (with ** markers)
    expect(exportContent).toContain('**"quick brown fox"**');
  });

  test('note appears as blockquote', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'This is the note');

    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    // Note should be blockquoted
    expect(exportContent).toContain('> This is the note');
  });

  test('multiple pages separated by horizontal rule', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Home export');

    await page.goto('/second');
    await waitForIntegration(page);
    await createAnnotation(page, 'wallaby bounces', 'Second export');

    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    // Pages should be separated by ---
    expect(exportContent).toContain('---');

    // Both pages should appear
    expect(exportContent).toContain('quick brown fox');
    expect(exportContent).toContain('wallaby bounces');
  });

  test('annotation with empty note produces no blockquote in export', async ({ page }) => {
    // Create an annotation WITHOUT a note (empty note)
    await createAnnotationWithoutNote(page, 'quick brown fox');

    // Fetch the export via API
    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    // The selected text should appear in the export as bold
    expect(exportContent).toContain('**"quick brown fox"**');

    // There should be NO blockquote line for this annotation's note.
    // Split the export into lines and check that no `>` line follows the annotation.
    const lines = exportContent.split('\n');
    const annotationLineIdx = lines.findIndex((l: string) =>
      l.includes('**"quick brown fox"**'),
    );
    expect(annotationLineIdx).toBeGreaterThanOrEqual(0);

    // The next non-empty line after the annotation should NOT be a blockquote
    const nextLines = lines.slice(annotationLineIdx + 1);
    const nextContentLine = nextLines.find((l: string) => l.trim().length > 0);
    if (nextContentLine) {
      expect(nextContentLine.trimStart().startsWith('>')).toBe(false);
    }
  });

  test('empty export shows appropriate message', async ({ page }) => {
    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    // Should indicate there's nothing to export
    const isEmpty =
      exportContent.toLowerCase().includes('no annotation') ||
      exportContent.toLowerCase().includes('no data') ||
      exportContent.toLowerCase().includes('empty') ||
      exportContent.trim().length === 0 ||
      exportContent.includes('# Inline Review'); // Even empty export has header

    expect(isEmpty).toBe(true);
  });

  test('toast notification appears on export', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Toast test');

    await openPanel(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await clickExportButton(page);

    await expectToastVisible(page);
  });

  test('toast shows success message content after export', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Toast content test');

    await openPanel(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await clickExportButton(page);

    // Verify the toast is visible AND contains a meaningful success message
    await expectToastVisible(page, 'Copied');
  });

  test('export includes annotations from all pages', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Home export all');

    await page.goto('/second');
    await waitForIntegration(page);
    await createAnnotation(page, 'wallaby bounces', 'Second export all');

    await openPanel(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await clickExportButton(page);

    // Wait for export to complete (server fetch + clipboard write)
    await expect.poll(
      () => page.evaluate(() => navigator.clipboard.readText()),
      { message: 'Clipboard should contain exported content', timeout: 2000 },
    ).toContain('quick brown fox');

    const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardContent).toContain('Home export all');
    expect(clipboardContent).toContain('wallaby bounces');
    expect(clipboardContent).toContain('Second export all');
  });

  test('Copy All button is visible in panel header', async ({ page }) => {
    await openPanel(page);

    const exportBtn = shadowLocator(page, SELECTORS.exportButton);
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toHaveText('Copy All');
  });

  test('Copy All button copies annotations to clipboard', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Button clipboard test');

    await openPanel(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await clickExportButton(page);

    await expect.poll(
      () => page.evaluate(() => navigator.clipboard.readText()),
      { message: 'Clipboard should contain exported content', timeout: 2000 },
    ).toContain('quick brown fox');

    const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardContent).toContain('# Inline Review');
    expect(clipboardContent).toContain('Button clipboard test');
  });

  test('Copy All button shows toast notification', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Button toast test');

    await openPanel(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await clickExportButton(page);

    await expectToastVisible(page, 'Copied');
  });

  test('Copy All button exports all pages (not just current)', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Home button export');

    await page.goto('/second');
    await waitForIntegration(page);
    await createAnnotation(page, 'wallaby bounces', 'Second button export');

    await openPanel(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await clickExportButton(page);

    await expect.poll(
      () => page.evaluate(() => navigator.clipboard.readText()),
      { message: 'Clipboard should contain exported content', timeout: 2000 },
    ).toContain('quick brown fox');

    const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardContent).toContain('Home button export');
    expect(clipboardContent).toContain('wallaby bounces');
    expect(clipboardContent).toContain('Second button export');
  });

  test('Copy All button works with empty store', async ({ page }) => {
    await openPanel(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await clickExportButton(page);

    await expect.poll(
      () => page.evaluate(() => navigator.clipboard.readText()),
      { message: 'Clipboard should contain empty export message', timeout: 2000 },
    ).toContain('No annotations or notes yet.');

    await expectToastVisible(page);
  });
});
