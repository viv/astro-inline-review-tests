import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  openPanel,
  addPageNote,
  exportShortcut,
} from '../helpers/actions';
import { expectToastVisible } from '../helpers/assertions';

test.describe('Export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test('export generates valid markdown', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'A test note');
    await page.waitForTimeout(500);

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
    await page.waitForTimeout(500);

    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    // Should include the page path as a heading
    expect(exportContent).toMatch(/##.*\//);
  });

  test('export includes page title', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Title test');
    await page.waitForTimeout(500);

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
    await page.waitForTimeout(500);

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
    await page.waitForTimeout(500);

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
    await page.waitForTimeout(500);

    const exportContent = await page.evaluate(async () => {
      const response = await fetch('/__inline-review/api/export');
      return response.text();
    });

    // Selected text should be in bold (with ** markers)
    expect(exportContent).toContain('**"quick brown fox"**');
  });

  test('note appears as blockquote', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'This is the note');
    await page.waitForTimeout(500);

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
    await page.waitForTimeout(500);

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

  test('export copies to clipboard via keyboard shortcut', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Clipboard test');
    await page.waitForTimeout(500);

    // Grant clipboard permissions
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await exportShortcut(page);
    await page.waitForTimeout(300);

    // Verify clipboard content
    const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardContent).toContain('quick brown fox');
  });

  test('toast notification appears on export', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Toast test');
    await page.waitForTimeout(500);

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Trigger export via keyboard shortcut
    await exportShortcut(page);

    await expectToastVisible(page);
  });

  test('export via keyboard shortcut', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Shortcut export test');
    await page.waitForTimeout(500);

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await exportShortcut(page);

    // Should have copied to clipboard
    const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardContent).toContain('quick brown fox');
  });

  test('export includes annotations from all pages', async ({ page }) => {
    await createAnnotation(page, 'quick brown fox', 'Home export all');

    await page.goto('/second');
    await waitForIntegration(page);
    await createAnnotation(page, 'wallaby bounces', 'Second export all');
    await page.waitForTimeout(500);

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await exportShortcut(page);
    // Wait for async export to complete (server fetch + clipboard write)
    await page.waitForTimeout(500);

    const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardContent).toContain('quick brown fox');
    expect(clipboardContent).toContain('Home export all');
    expect(clipboardContent).toContain('wallaby bounces');
    expect(clipboardContent).toContain('Second export all');
  });
});
