import { test, expect } from '@playwright/test';
import { getHost, SELECTORS } from '../helpers/selectors';
import { waitForIntegration, cleanReviewData } from '../helpers/actions';
import { expectHostExists, createConsoleErrorCollector } from '../helpers/assertions';

test.describe('Integration basics', () => {
  test.beforeEach(async ({ page }) => {
    cleanReviewData();
  });

  test('shadow DOM host element exists on the page', async ({ page }) => {
    // The integration should create a <div id="astro-inline-review-host"> with an open shadow root
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);

    await expectHostExists(page);

    // Verify it has an open shadow root
    const hasShadowRoot = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      return host?.shadowRoot !== null && host?.shadowRoot !== undefined;
    });
    expect(hasShadowRoot).toBe(true);
  });

  test('client script is injected on the page', async ({ page }) => {
    // The integration uses injectScript('page', ...) to add client-side JS
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);

    // Verify the FAB exists inside shadow DOM as proof the script ran
    const fabExists = await page.evaluate(() => {
      const host = document.getElementById('astro-inline-review-host');
      if (!host?.shadowRoot) return false;
      return host.shadowRoot.querySelector('[data-air-el="fab"]') !== null;
    });
    expect(fabExists).toBe(true);
  });

  test('no console errors on page load', async ({ page }) => {
    const errors = createConsoleErrorCollector(page);

    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);

    // Allow a short delay for any async errors to surface
    await page.waitForTimeout(500);

    expect(errors, `Console errors found: ${errors.join(', ')}`).toHaveLength(0);
  });

  test('integration does not modify existing page content', async ({ page }) => {
    // Capture the page content structure before the integration injects
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('astro-inline-review'));
    await waitForIntegration(page);

    // Verify known content paragraphs are intact
    const introText = await page.locator('#intro-paragraph').textContent();
    expect(introText).toContain('This is the introduction paragraph of the fixture site');

    const aboutText = await page.locator('#about-paragraph').textContent();
    expect(aboutText).toContain('The quick brown fox jumps over the lazy dog');

    const technicalText = await page.locator('#technical-paragraph').textContent();
    expect(technicalText).toContain('Software engineering requires careful attention to detail');

    // Verify nav links are intact (3 original + 2 in test-nav for element annotation testing)
    const navLinks = page.locator('nav a');
    await expect(navLinks).toHaveCount(5);
  });
});
