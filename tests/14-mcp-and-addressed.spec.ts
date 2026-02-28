import { test, expect, type Page } from '@playwright/test';
import { shadowLocator, SELECTORS, getHighlights } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  createElementAnnotation,
  openPanel,
  clickExportButton,
  readReviewStore,
  writeReviewStore,
  getClipboardText,
} from '../helpers/actions';
import {
  expectAnnotationItemCount,
  expectElementAnnotationItemCount,
} from '../helpers/assertions';

/**
 * Tests for MCP-produced data: addressed annotations and agent replies.
 *
 * Strategy: create annotations via the browser (captures correct XPaths),
 * then modify inline-review.json to add status/addressedAt/replies fields.
 * This avoids XPath calibration issues and ensures annotations are
 * not orphaned after reload.
 */

/**
 * Create an annotation via the browser, then modify the persisted store
 * to add fields (status, addressedAt, replies). Reloads the page so the panel
 * picks up the changes.
 */
async function createAndEnrich(
  page: Page,
  text: string,
  note: string,
  modifications: Record<string, unknown>,
): Promise<void> {
  await createAnnotation(page, text, note);
  const store = readReviewStore();
  expect(store).not.toBeNull();
  const annotation = store!.annotations[store!.annotations.length - 1];
  Object.assign(annotation, modifications);
  writeReviewStore(store! as { version: 1; annotations: Array<Record<string, unknown>>; pageNotes: Array<Record<string, unknown>> });
  await page.reload();
  await waitForIntegration(page);
}

test.describe('MCP addressed state and agent replies', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);
  });

  // ── Group A: Addressed annotations in panel ──────────────────────────

  test.describe('Group A: Addressed annotations in panel', () => {
    test('A1: addressed annotation shows wrench badge in panel', async ({ page }) => {
      await createAndEnrich(page, 'quick brown fox', 'Test note', {
        status: 'addressed',
        addressedAt: new Date().toISOString(),
      });

      await openPanel(page);

      const badge = shadowLocator(page, '[data-air-el="addressed-badge"]');
      await expect(badge).toBeVisible();
      await expect(badge).toContainText('Addressed');
    });

    test('A2: addressed annotation has dimmed/distinct styling', async ({ page }) => {
      // Create two annotations on different text
      await createAnnotation(page, 'quick brown fox', 'Will be addressed');
      await createAnnotation(page, 'Software engineering', 'Stays open');

      // Address only the first annotation
      const store = readReviewStore();
      expect(store).not.toBeNull();
      store!.annotations[0].status = 'addressed';
      store!.annotations[0].addressedAt = new Date().toISOString();
      writeReviewStore(store! as { version: 1; annotations: Array<Record<string, unknown>>; pageNotes: Array<Record<string, unknown>> });

      await page.reload();
      await waitForIntegration(page);
      await openPanel(page);

      // Both items should be in the panel
      await expectAnnotationItemCount(page, 2);

      // Addressed item should have the --addressed CSS class
      const addressedItems = shadowLocator(page, '.air-annotation-item--addressed');
      await expect(addressedItems).toHaveCount(1);

      // The addressed item should have reduced opacity
      await expect(addressedItems).toHaveCSS('opacity', '0.85');

      // The open item should have full opacity
      const openItem = shadowLocator(
        page,
        '[data-air-el="annotation-item"]:not(.air-annotation-item--addressed)',
      );
      await expect(openItem).toHaveCount(1);
      await expect(openItem).toHaveCSS('opacity', '1');
    });

    test('A3: addressed annotation shows addressedAt timestamp', async ({ page }) => {
      const addressedTime = '2025-06-15T14:30:00.000Z';
      await createAndEnrich(page, 'quick brown fox', 'Test note', {
        status: 'addressed',
        addressedAt: addressedTime,
      });

      await openPanel(page);

      const badge = shadowLocator(page, '[data-air-el="addressed-badge"]');
      await expect(badge).toBeVisible();

      // The timestamp should be rendered in a human-readable format
      const timeSpan = badge.locator('.air-annotation-item__addressed-time');
      await expect(timeSpan).toBeVisible();
      const timeText = await timeSpan.textContent();
      expect(timeText).toBeTruthy();
      // Should contain some date-like content (not the raw ISO string)
      expect(timeText!.length).toBeGreaterThan(0);
    });
  });

  // ── Group B: Agent replies in panel ─────────────────────────────────

  test.describe('Group B: Agent replies in panel', () => {
    test('B1: single agent reply displays beneath annotation', async ({ page }) => {
      await createAndEnrich(page, 'quick brown fox', 'Please review this', {
        replies: [
          {
            message: 'This looks good, no issues found.',
            createdAt: new Date().toISOString(),
          },
        ],
      });

      await openPanel(page);

      // Reply block should be visible
      const reply = shadowLocator(page, '[data-air-el="agent-reply"]');
      await expect(reply).toHaveCount(1);
      await expect(reply).toContainText('This looks good, no issues found.');

      // Should have "Agent:" prefix
      const prefix = reply.locator('.air-annotation-item__reply-prefix');
      await expect(prefix).toContainText('Agent:');
    });

    test('B2: multiple agent replies display in chronological order', async ({ page }) => {
      const earlierTime = '2025-06-15T10:00:00.000Z';
      const laterTime = '2025-06-15T11:00:00.000Z';

      await createAndEnrich(page, 'quick brown fox', 'Review needed', {
        replies: [
          { message: 'First reply from agent', createdAt: earlierTime },
          { message: 'Second reply from agent', createdAt: laterTime },
        ],
      });

      await openPanel(page);

      const replies = shadowLocator(page, '[data-air-el="agent-reply"]');
      await expect(replies).toHaveCount(2);

      // Verify order: first reply should appear before second
      await expect(replies.nth(0)).toContainText('First reply from agent');
      await expect(replies.nth(1)).toContainText('Second reply from agent');
    });

    test('B3: agent replies have distinct styling from reviewer notes', async ({ page }) => {
      await createAndEnrich(page, 'quick brown fox', 'My reviewer note', {
        replies: [
          {
            message: 'Agent response text',
            createdAt: new Date().toISOString(),
          },
        ],
      });

      await openPanel(page);

      // The reviewer's note
      const note = shadowLocator(page, '.air-annotation-item__note');
      await expect(note).toContainText('My reviewer note');

      // The agent reply
      const reply = shadowLocator(page, '[data-air-el="agent-reply"]');
      await expect(reply).toContainText('Agent response text');

      // Reply should have a distinct left border (green)
      await expect(reply).toHaveCSS('border-left-color', 'rgb(34, 197, 94)');

      // Reply prefix should be styled differently from the note
      const prefix = reply.locator('.air-annotation-item__reply-prefix');
      await expect(prefix).toHaveCSS('color', 'rgb(34, 197, 94)');
    });
  });

  // ── Group F: Edge cases ─────────────────────────────────────────────

  test.describe('Group F: Edge cases', () => {
    test('F1: annotation with replies but not addressed renders correctly', async ({ page }) => {
      await createAndEnrich(page, 'quick brown fox', 'Has replies only', {
        replies: [
          {
            message: 'Agent reply without addressing',
            createdAt: new Date().toISOString(),
          },
        ],
        // Deliberately no status/addressedAt
      });

      await openPanel(page);

      // Reply should be visible
      const reply = shadowLocator(page, '[data-air-el="agent-reply"]');
      await expect(reply).toHaveCount(1);
      await expect(reply).toContainText('Agent reply without addressing');

      // No addressed badge should be present
      const badge = shadowLocator(page, '[data-air-el="addressed-badge"]');
      await expect(badge).toHaveCount(0);

      // Item should NOT have addressed class
      const addressedItems = shadowLocator(page, '.air-annotation-item--addressed');
      await expect(addressedItems).toHaveCount(0);
    });

    test('F2: annotation with no replies and no addressedAt renders as before', async ({ page }) => {
      // Create a plain annotation (no modifications)
      await createAnnotation(page, 'quick brown fox', 'Plain annotation');

      await openPanel(page);
      await expectAnnotationItemCount(page, 1);

      // No addressed badge
      const badge = shadowLocator(page, '[data-air-el="addressed-badge"]');
      await expect(badge).toHaveCount(0);

      // No agent replies
      const reply = shadowLocator(page, '[data-air-el="agent-reply"]');
      await expect(reply).toHaveCount(0);

      // Item should NOT have addressed class
      const addressedItems = shadowLocator(page, '.air-annotation-item--addressed');
      await expect(addressedItems).toHaveCount(0);

      // Note should be present
      const note = shadowLocator(page, '.air-annotation-item__note');
      await expect(note).toContainText('Plain annotation');
    });

    test('F3: empty replies array renders as no replies', async ({ page }) => {
      await createAndEnrich(page, 'quick brown fox', 'Has empty replies', {
        replies: [],
      });

      await openPanel(page);

      // No agent replies should be rendered
      const reply = shadowLocator(page, '[data-air-el="agent-reply"]');
      await expect(reply).toHaveCount(0);

      // Note should still be present
      const note = shadowLocator(page, '.air-annotation-item__note');
      await expect(note).toContainText('Has empty replies');
    });

    test('F4: addressed element annotation shows addressed state', async ({ page }) => {
      // Create element annotation via browser, then enrich with addressed status
      await createElementAnnotation(page, '#hero-section', 'Element to address');

      const store = readReviewStore();
      expect(store).not.toBeNull();
      const annotation = store!.annotations[store!.annotations.length - 1];
      annotation.status = 'addressed';
      annotation.addressedAt = new Date().toISOString();
      writeReviewStore(store! as { version: 1; annotations: Array<Record<string, unknown>>; pageNotes: Array<Record<string, unknown>> });

      await page.reload();
      await waitForIntegration(page);

      // Element highlight should exist with addressed styling (blue outline)
      const elementHighlight = page.locator('[data-air-element-id]');
      await expect(elementHighlight).toHaveCount(1);
      await expect(elementHighlight).toHaveCSS('outline-color', 'rgba(59, 130, 246, 0.5)');

      // Panel should show addressed indicator
      await openPanel(page);
      await expectElementAnnotationItemCount(page, 1);
      const badge = shadowLocator(page, '[data-air-el="addressed-badge"]');
      await expect(badge).toBeVisible();
      await expect(badge).toContainText('Addressed');
    });

    test('F5: legacy resolvedAt field is treated as addressed (backward compat)', async ({ page }) => {
      // Simulate legacy data with resolvedAt but no status field
      await createAndEnrich(page, 'quick brown fox', 'Legacy resolved note', {
        resolvedAt: new Date().toISOString(),
      });

      await openPanel(page);

      // Should be displayed as addressed (backward compat mapping)
      const badge = shadowLocator(page, '[data-air-el="addressed-badge"]');
      await expect(badge).toBeVisible();
      await expect(badge).toContainText('Addressed');

      // Should have addressed class
      const addressedItems = shadowLocator(page, '.air-annotation-item--addressed');
      await expect(addressedItems).toHaveCount(1);
    });
  });

  // ── Group C: Addressed highlights ────────────────────────────────────

  test.describe('Group C: Addressed highlights', () => {
    test('C1: addressed annotation highlight has distinct styling', async ({ page }) => {
      await createAndEnrich(page, 'quick brown fox', 'Will be addressed', {
        status: 'addressed',
        addressedAt: new Date().toISOString(),
      });

      // The highlight mark should exist in the light DOM
      const highlights = getHighlights(page);
      await expect(highlights).toHaveCount(1);

      // Addressed highlights use blue background: rgba(59,130,246,0.2)
      // Default (open) uses amber: rgba(217,119,6,0.3)
      const mark = highlights.first();
      await expect(mark).toHaveCSS('background-color', 'rgba(59, 130, 246, 0.2)');
    });

    test('C2: open and addressed highlights coexist', async ({ page }) => {
      await createAnnotation(page, 'quick brown fox', 'Will be addressed');
      await createAnnotation(page, 'Software engineering', 'Stays open');

      // Address only the first annotation
      const store = readReviewStore();
      expect(store).not.toBeNull();
      store!.annotations[0].status = 'addressed';
      store!.annotations[0].addressedAt = new Date().toISOString();
      writeReviewStore(store! as { version: 1; annotations: Array<Record<string, unknown>>; pageNotes: Array<Record<string, unknown>> });

      await page.reload();
      await waitForIntegration(page);

      // Both highlights should exist
      const highlights = getHighlights(page);
      await expect(highlights).toHaveCount(2);

      // Get background colours of both marks
      const colours = await highlights.evaluateAll((marks) =>
        marks.map((m) => getComputedStyle(m).backgroundColor),
      );

      // One should be addressed (blue) and one should be default (amber)
      const addressedColour = 'rgba(59, 130, 246, 0.2)';
      const defaultColour = 'rgba(217, 119, 6, 0.3)';

      expect(colours).toContain(addressedColour);
      expect(colours).toContain(defaultColour);
      expect(colours[0]).not.toEqual(colours[1]);
    });
  });

  // ── Group D: Export with addressed & replies ─────────────────────────

  test.describe('Group D: Export with addressed & replies', () => {
    test('D1: export includes [Addressed] indicator', async ({ page }) => {
      await createAndEnrich(page, 'quick brown fox', 'Addressed note', {
        status: 'addressed',
        addressedAt: new Date().toISOString(),
      });

      const exportContent = await page.evaluate(async () => {
        const response = await fetch('/__inline-review/api/export');
        return response.text();
      });

      expect(exportContent).toContain('quick brown fox');
      expect(exportContent).toContain('🔧 [Addressed]');
    });

    test('D2: export includes agent replies as blockquotes', async ({ page }) => {
      await createAndEnrich(page, 'quick brown fox', 'Has replies', {
        replies: [
          { message: 'Looks good to me', createdAt: '2025-06-15T10:00:00.000Z' },
          { message: 'No further issues', createdAt: '2025-06-15T11:00:00.000Z' },
        ],
      });

      const exportContent = await page.evaluate(async () => {
        const response = await fetch('/__inline-review/api/export');
        return response.text();
      });

      expect(exportContent).toContain('quick brown fox');
      expect(exportContent).toContain('> **Agent:** Looks good to me');
      expect(exportContent).toContain('> **Agent:** No further issues');
    });

    test('D3: clipboard export includes addressed and reply data', async ({ page }) => {
      await createAndEnrich(page, 'quick brown fox', 'Clipboard addressed test', {
        status: 'addressed',
        addressedAt: new Date().toISOString(),
        replies: [
          { message: 'Agent clipboard reply', createdAt: new Date().toISOString() },
        ],
      });

      await openPanel(page);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

      await clickExportButton(page);

      // Wait for clipboard to be populated
      await expect.poll(
        () => page.evaluate(() => navigator.clipboard.readText()),
        { message: 'Clipboard should contain exported content', timeout: 2000 },
      ).toContain('quick brown fox');

      const clipboardContent = await getClipboardText(page);
      expect(clipboardContent).toContain('🔧 [Addressed]');
      expect(clipboardContent).toContain('> **Agent:** Agent clipboard reply');
    });
  });

  // ── Group E: REST API compatibility ─────────────────────────────────

  test.describe('Group E: REST API compatibility', () => {
    test('E1: GET /annotations returns status, addressedAt and replies fields', async ({ page }) => {
      await createAndEnrich(page, 'quick brown fox', 'API test', {
        status: 'addressed',
        addressedAt: '2025-06-15T14:30:00.000Z',
        replies: [
          { message: 'API reply test', createdAt: '2025-06-15T15:00:00.000Z' },
        ],
      });

      const responseData = await page.evaluate(async () => {
        const response = await fetch('/__inline-review/api/annotations');
        return response.json();
      });

      // Response should be a store with annotations array
      expect(responseData.annotations).toBeDefined();
      expect(responseData.annotations.length).toBeGreaterThanOrEqual(1);

      const annotation = responseData.annotations[0];
      expect(annotation.status).toBe('addressed');
      expect(annotation.addressedAt).toBe('2025-06-15T14:30:00.000Z');
      expect(annotation.replies).toBeDefined();
      expect(annotation.replies).toHaveLength(1);
      expect(annotation.replies[0].message).toBe('API reply test');
      expect(annotation.replies[0].createdAt).toBe('2025-06-15T15:00:00.000Z');
    });

    test('E2: PATCH /annotations/:id does not clear addressedAt or replies', async ({ page }) => {
      await createAndEnrich(page, 'quick brown fox', 'Will be patched', {
        status: 'addressed',
        addressedAt: '2025-06-15T14:30:00.000Z',
        replies: [
          { message: 'Should survive PATCH', createdAt: '2025-06-15T15:00:00.000Z' },
        ],
      });

      // Get the annotation ID from the store
      const store = readReviewStore();
      expect(store).not.toBeNull();
      const annotationId = store!.annotations[0].id as string;

      // PATCH to update the note
      const patchResponse = await page.evaluate(
        async ({ id }) => {
          const response = await fetch(`/__inline-review/api/annotations/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: 'Updated note after PATCH' }),
          });
          return { ok: response.ok, status: response.status };
        },
        { id: annotationId },
      );

      expect(patchResponse.ok).toBe(true);

      // Read back from the file and verify addressedAt and replies are preserved
      const updatedStore = readReviewStore();
      expect(updatedStore).not.toBeNull();
      const updatedAnnotation = updatedStore!.annotations[0];

      expect(updatedAnnotation.note).toBe('Updated note after PATCH');
      expect(updatedAnnotation.addressedAt).toBe('2025-06-15T14:30:00.000Z');
      expect(updatedAnnotation.replies).toBeDefined();
      const replies = updatedAnnotation.replies as Array<{ message: string; createdAt: string }>;
      expect(replies).toHaveLength(1);
      expect(replies[0].message).toBe('Should survive PATCH');
    });
  });
});
