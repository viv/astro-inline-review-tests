import { type Page, type Locator } from '@playwright/test';

/**
 * Shadow DOM query helpers for astro-inline-review.
 *
 * The integration creates a single host element:
 *   <div id="astro-inline-review-host"> with an open shadow root.
 *
 * All UI (FAB, panel, popup) lives inside the shadow root.
 * Highlights (<mark>) live in the light DOM with data-air-id attributes.
 *
 * Selectors use data-air-el attributes — the component's stable automation
 * contract — rather than internal CSS class names. This keeps the tests
 * decoupled from styling implementation details.
 */

/** The shadow DOM host element ID */
export const HOST_ID = 'astro-inline-review-host';

/** Stable selectors using data-air-el attributes (automation contract) */
export const SELECTORS = {
  host: `#${HOST_ID}`,
  fab: '[data-air-el="fab"]',
  fabBadge: '[data-air-el="badge"]',
  panel: '[data-air-el="panel"]',
  popup: '[data-air-el="popup"]',
  popupTextarea: '[data-air-el="popup-textarea"]',
  popupSave: '[data-air-el="popup-save"]',
  popupCancel: '[data-air-el="popup-cancel"]',
  popupDelete: '[data-air-el="popup-delete"]',
  tabThisPage: '[data-air-el="tab-this-page"]',
  tabAllPages: '[data-air-el="tab-all-pages"]',
  annotationItem: '[data-air-el="annotation-item"]',
  elementAnnotationItem: '[data-air-el="element-annotation-item"]',
  pageNoteItem: '[data-air-el="page-note-item"]',
  pageNoteAdd: '[data-air-el="page-note-add"]',
  pageNoteTextarea: '[data-air-el="page-note-textarea"]',
  pageNoteSave: '[data-air-el="page-note-save"]',
  pageNoteCancel: '[data-air-el="page-note-cancel"]',
  pageNoteEdit: '[data-air-el="page-note-edit"]',
  pageNoteDelete: '[data-air-el="page-note-delete"]',
  clearAllButton: '[data-air-el="clear-all"]',
  exportButton: '[data-air-el="export"]',
  toast: '[data-air-el="toast"]',
  highlight: 'mark[data-air-id]',
  elementHighlight: '[data-air-element-id]',
  inspectorOverlay: '[data-air-el="inspector-overlay"]',
  inspectorLabel: '[data-air-el="inspector-label"]',
  panelContent: '[data-air-el="panel-content"]',
} as const;

/**
 * Get the shadow DOM host element.
 */
export function getHost(page: Page): Locator {
  return page.locator(SELECTORS.host);
}

/**
 * Get a locator for an element inside the shadow DOM.
 * Uses Playwright's built-in shadow DOM piercing.
 */
export function shadowLocator(page: Page, selector: string): Locator {
  return page.locator(`${SELECTORS.host}`).locator(selector);
}

/**
 * Query an element inside the shadow root using page.evaluate.
 * Useful when Playwright's built-in piercing doesn't work for a specific case.
 */
export async function shadowQuery(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(
    ({ hostId, sel }) => {
      const host = document.getElementById(hostId);
      if (!host?.shadowRoot) return false;
      return host.shadowRoot.querySelector(sel) !== null;
    },
    { hostId: HOST_ID, sel: selector },
  );
}

/**
 * Get all elements matching a selector inside the shadow root.
 * Returns the count of matching elements.
 */
export async function shadowQueryCount(page: Page, selector: string): Promise<number> {
  return page.evaluate(
    ({ hostId, sel }) => {
      const host = document.getElementById(hostId);
      if (!host?.shadowRoot) return 0;
      return host.shadowRoot.querySelectorAll(sel).length;
    },
    { hostId: HOST_ID, sel: selector },
  );
}

/**
 * Get the text content of an element inside the shadow root.
 */
export async function shadowTextContent(page: Page, selector: string): Promise<string | null> {
  return page.evaluate(
    ({ hostId, sel }) => {
      const host = document.getElementById(hostId);
      if (!host?.shadowRoot) return null;
      const el = host.shadowRoot.querySelector(sel);
      return el?.textContent ?? null;
    },
    { hostId: HOST_ID, sel: selector },
  );
}

/**
 * Get all highlight marks in the light DOM.
 */
export function getHighlights(page: Page): Locator {
  return page.locator(SELECTORS.highlight);
}

/**
 * Get highlights with a specific annotation ID.
 */
export function getHighlightById(page: Page, annotationId: string): Locator {
  return page.locator(`mark[data-air-id="${annotationId}"]`);
}

/**
 * Get all element highlights in the light DOM (elements with data-air-element-id).
 */
export function getElementHighlights(page: Page): Locator {
  return page.locator(SELECTORS.elementHighlight);
}

/**
 * Get an element highlight by annotation ID.
 */
export function getElementHighlightById(page: Page, annotationId: string): Locator {
  return page.locator(`[data-air-element-id="${annotationId}"]`);
}

/**
 * Get the inspector overlay (only present during Alt+hover).
 */
export function getInspectorOverlay(page: Page): Locator {
  return page.locator(SELECTORS.inspectorOverlay);
}

/**
 * Get the inspector label (child of inspector overlay).
 */
export function getInspectorLabel(page: Page): Locator {
  return page.locator(SELECTORS.inspectorLabel);
}
