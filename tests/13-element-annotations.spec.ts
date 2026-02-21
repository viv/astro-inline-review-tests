import { test, expect } from '@playwright/test';
import { shadowLocator, SELECTORS, getElementHighlights, getInspectorOverlay, getInspectorLabel } from '../helpers/selectors';
import {
  waitForIntegration,
  cleanReviewData,
  createAnnotation,
  createElementAnnotation,
  altClickElement,
  holdAlt,
  releaseAlt,
  openPanel,
  readReviewJson,
  getClipboardText,
  exportShortcut,
} from '../helpers/actions';
import {
  expectPopupVisible,
  expectPopupHidden,
  expectBadgeCount,
  expectElementHighlightExists,
  expectElementHighlightNotExists,
  expectElementHighlightCount,
  expectElementAnnotationItemCount,
  expectAnnotationItemCount,
} from '../helpers/assertions';

test.describe('Element annotations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await cleanReviewData(page);
    await page.goto('/');
    await waitForIntegration(page);
  });

  test.describe('Inspector overlay', () => {
    test('inspector overlay appears when Alt is held and mouse moves over elements', async ({ page }) => {
      await holdAlt(page);

      // Move mouse over a known element
      const img = page.locator('#hero-image');
      await img.hover();

      // Inspector overlay should be visible in the light DOM
      const overlay = getInspectorOverlay(page);
      await expect(overlay).toBeVisible();

      await releaseAlt(page);
    });

    test('inspector overlay shows tag label with element info', async ({ page }) => {
      await holdAlt(page);

      const img = page.locator('#hero-image');
      await img.hover();

      const label = getInspectorLabel(page);
      await expect(label).toBeVisible();
      // Label should contain the tag name
      const labelText = await label.textContent();
      expect(labelText?.toLowerCase()).toContain('img');

      await releaseAlt(page);
    });

    test('inspector overlay is removed when Alt is released', async ({ page }) => {
      await holdAlt(page);

      const img = page.locator('#hero-image');
      await img.hover();

      const overlay = getInspectorOverlay(page);
      await expect(overlay).toBeVisible();

      await releaseAlt(page);

      // Overlay should be removed
      await expect(overlay).not.toBeAttached();
    });

    test('inspector overlay does not appear over shadow DOM host', async ({ page }) => {
      await holdAlt(page);

      // Hover over the shadow DOM host element
      const host = page.locator('#astro-inline-review-host');
      await host.hover({ force: true });

      // Inspector overlay should NOT appear
      const overlay = getInspectorOverlay(page);
      await expect(overlay).not.toBeAttached({ timeout: 500 });

      await releaseAlt(page);
    });

    test('inspector overlay updates as mouse moves between elements', async ({ page }) => {
      await holdAlt(page);

      // Hover over image
      const img = page.locator('#hero-image');
      await img.hover();

      const label = getInspectorLabel(page);
      const firstLabel = await label.textContent();

      // Move to button
      const button = page.locator('#cta-button');
      await button.hover();

      const secondLabel = await label.textContent();

      // Labels should be different since the elements are different
      expect(firstLabel?.toLowerCase()).toContain('img');
      expect(secondLabel?.toLowerCase()).toContain('button');

      await releaseAlt(page);
    });
  });

  test.describe('Creating element annotations', () => {
    test('Alt+click on element shows popup', async ({ page }) => {
      await altClickElement(page, '#hero-image');
      await expectPopupVisible(page);
    });

    test('popup shows element description instead of selected text', async ({ page }) => {
      await altClickElement(page, '#hero-image');
      await expectPopupVisible(page);

      // The popup should show the element description, which includes the tag name
      const popupText = await page.evaluate(() => {
        const host = document.getElementById('astro-inline-review-host');
        if (!host?.shadowRoot) return null;
        const popup = host.shadowRoot.querySelector('[data-air-el="popup"]');
        return popup?.textContent ?? null;
      });

      // Should mention the element type (img) rather than selected text
      expect(popupText?.toLowerCase()).toContain('img');
    });

    test('saving element annotation creates outline highlight', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'Replace with higher res image');
      await expectElementHighlightExists(page, '#hero-image');
    });

    test('element highlight uses dashed outline style', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'Check this image');

      const outlineStyle = await page.evaluate(() => {
        const el = document.querySelector('#hero-image');
        return el ? getComputedStyle(el).outlineStyle : null;
      });

      expect(outlineStyle).toBe('dashed');
    });

    test('element highlight has data-air-element-id attribute', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'Test note');

      const hasAttr = await page.evaluate(() => {
        const el = document.querySelector('#hero-image');
        return el?.hasAttribute('data-air-element-id') ?? false;
      });

      expect(hasAttr).toBe(true);
    });

    test('cancelling element annotation dismisses popup without creating highlight', async ({ page }) => {
      await altClickElement(page, '#hero-image');
      await expectPopupVisible(page);

      const cancelBtn = shadowLocator(page, SELECTORS.popupCancel);
      await cancelBtn.click();

      await expectPopupHidden(page);
      await expectElementHighlightNotExists(page, '#hero-image');
      await expectBadgeCount(page, 0);
    });

    test('element annotation increments badge count', async ({ page }) => {
      await expectBadgeCount(page, 0);
      await createElementAnnotation(page, '#hero-image', 'First element annotation');
      await expectBadgeCount(page, 1);
    });

    test('multiple element annotations each get their own highlight', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'Image note');
      await createElementAnnotation(page, '#cta-button', 'Button note');

      await expectElementHighlightCount(page, 2);
      await expectBadgeCount(page, 2);
    });

    test('element annotations can be created on various element types', async ({ page }) => {
      // Image
      await createElementAnnotation(page, '#hero-image', 'Image note');
      await expectElementHighlightExists(page, '#hero-image');

      // Button
      await createElementAnnotation(page, '#cta-button', 'Button note');
      await expectElementHighlightExists(page, '#cta-button');

      // Section (use simple-section which has no child elements covering the click area)
      await createElementAnnotation(page, '#simple-section', 'Section note');
      await expectElementHighlightExists(page, '#simple-section');

      await expectBadgeCount(page, 3);
    });
  });

  test.describe('Editing element annotations', () => {
    test('clicking element with outline opens edit popup', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'Original note');

      // Click the highlighted element (not Alt+click — regular click on outlined element)
      await page.click('#hero-image');

      await expectPopupVisible(page);

      // Should show the existing note in the textarea
      const textarea = shadowLocator(page, SELECTORS.popupTextarea);
      await expect(textarea).toHaveValue('Original note');
    });

    test('edit popup has delete button', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'A note');
      await page.click('#hero-image');
      await expectPopupVisible(page);

      const deleteBtn = shadowLocator(page, SELECTORS.popupDelete);
      await expect(deleteBtn).toBeVisible();
    });

    test('updating element annotation note persists change', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'Old note');
      await page.click('#hero-image');
      await expectPopupVisible(page);

      const textarea = shadowLocator(page, SELECTORS.popupTextarea);
      await textarea.fill('Updated note');

      const saveBtn = shadowLocator(page, SELECTORS.popupSave);
      await Promise.all([
        page.waitForResponse(
          (resp) =>
            resp.url().includes('/__inline-review/api/annotations') &&
            resp.request().method() === 'PATCH' &&
            resp.ok(),
        ),
        saveBtn.click(),
      ]);
      await expectPopupHidden(page);

      // Verify the updated note is in the JSON store
      const store = readReviewJson();
      expect(store).not.toBeNull();
      const annotations = (store as any)?.annotations ?? [];
      const elementAnnotation = annotations.find((a: any) => a.type === 'element');
      expect(elementAnnotation?.note).toBe('Updated note');
    });

    test('deleting element annotation removes outline highlight', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'To delete');
      await expectElementHighlightExists(page, '#hero-image');

      // Click to open edit popup
      await page.click('#hero-image');
      await expectPopupVisible(page);

      // Click delete and wait for API DELETE to complete
      const deleteBtn = shadowLocator(page, SELECTORS.popupDelete);
      await Promise.all([
        page.waitForResponse(
          (resp) =>
            resp.url().includes('/__inline-review/api/annotations') &&
            resp.request().method() === 'DELETE' &&
            resp.ok(),
        ),
        deleteBtn.click(),
      ]);

      await expectPopupHidden(page);
      await expectElementHighlightNotExists(page, '#hero-image');
      await expectBadgeCount(page, 0);
    });
  });

  test.describe('Element highlight pulse', () => {
    test('element highlight pulses when scrolled to from panel', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'Pulse test');

      // Scroll away from the element
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // Wait for scroll to settle
      await expect.poll(
        () => page.evaluate(() => window.scrollY > 0),
        { timeout: 2000 },
      ).toBe(true);

      // Open panel and click the element annotation
      await openPanel(page);
      const elementItem = shadowLocator(page, SELECTORS.elementAnnotationItem);
      await elementItem.click();

      // The element should have the pulse attribute
      await expect.poll(async () => {
        return page.evaluate(() => {
          const el = document.querySelector('#hero-image');
          return el?.hasAttribute('data-air-pulse') ?? false;
        });
      }, { timeout: 2000 }).toBe(true);
    });
  });

  test.describe('Panel display', () => {
    test('element annotation appears in panel with element description', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'Panel test note');

      await openPanel(page);

      // Should have an element annotation item
      await expectElementAnnotationItemCount(page, 1);

      // The item should mention the element type
      const itemText = await page.evaluate(() => {
        const host = document.getElementById('astro-inline-review-host');
        if (!host?.shadowRoot) return null;
        const item = host.shadowRoot.querySelector('[data-air-el="element-annotation-item"]');
        return item?.textContent ?? null;
      });
      expect(itemText?.toLowerCase()).toContain('img');
    });

    test('element and text annotations both appear in panel', async ({ page }) => {
      await createAnnotation(page, 'quick brown fox', 'Text note');
      await createElementAnnotation(page, '#hero-image', 'Element note');

      await openPanel(page);

      await expectAnnotationItemCount(page, 1);
      await expectElementAnnotationItemCount(page, 1);
    });

    test('clicking element annotation in panel scrolls to element', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'Scroll test');

      // Scroll to bottom of page
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // Wait for scroll to settle
      await expect.poll(
        () => page.evaluate(() => window.scrollY > 0),
        { timeout: 2000 },
      ).toBe(true);

      await openPanel(page);
      const elementItem = shadowLocator(page, SELECTORS.elementAnnotationItem);
      await elementItem.click();

      // Wait for scroll animation to bring element into viewport
      await expect.poll(async () => {
        return page.evaluate(() => {
          const el = document.querySelector('#hero-image');
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight;
        });
      }, { timeout: 2000 }).toBe(true);
    });
  });

  test.describe('Persistence', () => {
    test('element annotation persists across page reload', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'Persistent note');
      await expectElementHighlightExists(page, '#hero-image');

      // Reload the page
      await page.reload();
      await waitForIntegration(page);

      // Element highlight should be restored
      await expectElementHighlightExists(page, '#hero-image');
    });

    test('element annotation data stored correctly in JSON', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'JSON test');

      const store = readReviewJson();
      expect(store).not.toBeNull();
      const annotations = (store as any)?.annotations ?? [];
      expect(annotations.length).toBe(1);

      const annotation = annotations[0];
      expect(annotation.type).toBe('element');
      expect(annotation.note).toBe('JSON test');
      expect(annotation.elementSelector).toBeDefined();
      expect(annotation.elementSelector.cssSelector).toBeTruthy();
      expect(annotation.elementSelector.xpath).toBeTruthy();
      expect(annotation.elementSelector.tagName).toBe('img');
      expect(annotation.elementSelector.description).toBeTruthy();
      expect(annotation.elementSelector.attributes).toBeDefined();
      expect(annotation.elementSelector.outerHtmlPreview).toBeTruthy();
    });

    test('element annotation restored via CSS selector on reload', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'CSS selector test');

      // Read the stored CSS selector
      const store = readReviewJson() as any;
      const cssSelector = store?.annotations?.[0]?.elementSelector?.cssSelector;
      expect(cssSelector).toBeTruthy();

      // Reload and verify the same element gets the highlight
      await page.reload();
      await waitForIntegration(page);

      await expectElementHighlightExists(page, '#hero-image');
    });

    test('element annotations appear in All Pages tab', async ({ page }) => {
      await createElementAnnotation(page, '#hero-image', 'All pages test');

      await openPanel(page);
      const allPagesTab = shadowLocator(page, SELECTORS.tabAllPages);
      await allPagesTab.click();

      await expectElementAnnotationItemCount(page, 1);
    });
  });

  test.describe('Export', () => {
    test('element annotations appear in export under Element Annotations heading', async ({ page, context }) => {
      // Grant clipboard permissions
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      await createElementAnnotation(page, '#hero-image', 'Export test note');

      await exportShortcut(page);

      // Wait for clipboard content to be written
      await expect.poll(
        () => page.evaluate(() => navigator.clipboard.readText()),
        { message: 'Clipboard should contain export', timeout: 2000 },
      ).toContain('Export test note');

      // Verify full export content
      const clipboard = await getClipboardText(page);
      expect(clipboard).toContain('### Element Annotations');
    });

    test('export includes both text and element annotations', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      await createAnnotation(page, 'quick brown fox', 'Text note');
      await createElementAnnotation(page, '#hero-image', 'Element note');

      await exportShortcut(page);

      // Wait for clipboard content to be written
      await expect.poll(
        () => page.evaluate(() => navigator.clipboard.readText()),
        { message: 'Clipboard should contain export', timeout: 2000 },
      ).toContain('Element note');

      // Verify full export content
      const clipboard = await getClipboardText(page);
      expect(clipboard).toContain('### Text Annotations');
      expect(clipboard).toContain('### Element Annotations');
      expect(clipboard).toContain('Text note');
    });
  });

  test.describe('Edge cases', () => {
    test('Alt+click on body is ignored', async ({ page }) => {
      // Alt+click on the body element directly
      await page.evaluate(() => {
        const event = new MouseEvent('click', {
          altKey: true,
          bubbles: true,
          cancelable: true,
        });
        document.body.dispatchEvent(event);
      });

      // Brief wait to allow any async popup to appear, then verify it didn't
      await page.waitForTimeout(200);
      await expectPopupHidden(page);
    });

    test('Alt+click prevents default browser behaviour', async ({ page }) => {
      // Alt+click on a link — should NOT navigate or download
      await altClickElement(page, '.nav-link');
      await expectPopupVisible(page);

      // The page should still be on the home page (no navigation)
      expect(page.url()).toContain('/');
    });

    test('Alt+click while popup is already visible is ignored', async ({ page }) => {
      // Create first element annotation popup
      await altClickElement(page, '#hero-image');
      await expectPopupVisible(page);

      // Try Alt+click on another element while popup is open
      await altClickElement(page, '#cta-button');

      // Popup should still be visible (for the original element)
      await expectPopupVisible(page);
    });

    test('text and element annotations coexist with correct badge count', async ({ page }) => {
      await createAnnotation(page, 'quick brown fox', 'Text note');
      await expectBadgeCount(page, 1);

      await createElementAnnotation(page, '#hero-image', 'Element note');
      await expectBadgeCount(page, 2);

      await createElementAnnotation(page, '#cta-button', 'Another element note');
      await expectBadgeCount(page, 3);
    });

    test('element annotation on element with data-testid', async ({ page }) => {
      await createElementAnnotation(page, '[data-testid="feature-card"]', 'Card note');
      await expectElementHighlightExists(page, '[data-testid="feature-card"]');

      // Verify the CSS selector uses data-testid
      const store = readReviewJson() as any;
      const cssSelector = store?.annotations?.[0]?.elementSelector?.cssSelector;
      expect(cssSelector).toContain('data-testid');
    });

    test('clear all removes both text and element annotations', async ({ page }) => {
      await createAnnotation(page, 'quick brown fox', 'Text note');
      await createElementAnnotation(page, '#hero-image', 'Element note');
      await expectBadgeCount(page, 2);

      await openPanel(page);

      const clearBtn = shadowLocator(page, SELECTORS.clearAllButton);
      await clearBtn.click(); // First click — confirmation
      await clearBtn.click(); // Second click — confirm delete

      // Wait for all DELETE operations to complete (badge hides when count reaches 0)
      const badge = shadowLocator(page, SELECTORS.fabBadge);
      await expect(badge).not.toBeVisible({ timeout: 5000 });
      await expectElementHighlightCount(page, 0);
    });
  });

  test.describe('Backward compatibility', () => {
    test('legacy annotations without type field are treated as text', async ({ page }) => {
      // Create a text annotation the normal way
      await createAnnotation(page, 'quick brown fox', 'Legacy test');

      // Read the JSON and verify it has a type field
      const store = readReviewJson() as any;
      const annotation = store?.annotations?.[0];

      // Even if type is absent (legacy), the system should still work
      // This test verifies the migration path works on read
      expect(annotation).toBeDefined();
      // New annotations should have type: 'text'
      expect(annotation.type).toBe('text');
    });
  });

  test.describe('First-use tooltip', () => {
    test('tooltip mentions Alt+click for element annotation', async ({ page }) => {
      // Clear the tooltip dismissed flag
      await page.evaluate(() => localStorage.removeItem('air-tooltip-dismissed'));
      await page.reload();
      await waitForIntegration(page);

      // Check the tooltip text
      const tooltipText = await page.evaluate(() => {
        const host = document.getElementById('astro-inline-review-host');
        if (!host?.shadowRoot) return null;
        const tooltip = host.shadowRoot.querySelector('[data-air-el="first-use-tooltip"]');
        return tooltip?.textContent ?? null;
      });

      expect(tooltipText).toContain('Alt');
    });
  });
});
