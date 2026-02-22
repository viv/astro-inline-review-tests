---
generated_by: Claude Opus 4.6
generation_date: 2026-02-22
model_version: claude-opus-4-6
purpose: implementation_plan
status: implemented
human_reviewer: matthewvivian
tags: [export, button, acceptance-tests, playwright]
---

# Export Button — Acceptance Test Plan

## Context

The main `astro-inline-review` component now has a "Copy All" button in the
panel header (between "+ Note" and "Clear All"). This was added in commit
`1033ba1` to make export discoverable without needing the keyboard shortcut.

The existing `09-export.spec.ts` tests only cover export via the keyboard
shortcut (`Cmd/Ctrl+Shift+E`) and the server API endpoint. No acceptance
tests exist for the button-triggered export.

## What Changed in the Component

1. **New button**: `<button data-air-el="export">Copy All</button>` in the
   panel header actions row
2. **Button order**: "+ Note" | "Copy All" | "Clear All"
3. **Styling**: Orange accent class `air-panel__btn--export` (border + text
   colour matches the FAB and active tab accent)
4. **Behaviour**: Identical to keyboard shortcut — fetches full store from
   server, copies Markdown to clipboard, shows toast
5. **New selector needed**: `SELECTORS.exportButton` →
   `[data-air-el="export"]`

## Changes Needed

### 1. Add selector (`helpers/selectors.ts`)

Add to the `SELECTORS` object:

```typescript
exportButton: '[data-air-el="export"]',
```

Place it after `clearAllButton` for logical grouping with other panel header
buttons.

### 2. New tests in `09-export.spec.ts`

Add the following scenarios to the existing Export test suite:

#### Test: Copy All button is visible in panel header

- Open panel
- Assert `[data-air-el="export"]` exists and is visible
- Assert button text is "Copy All"

#### Test: Copy All button copies annotations to clipboard

- Create an annotation
- Open panel
- Grant clipboard permissions
- Click the Copy All button
- Assert clipboard contains the annotation text
- Assert clipboard contains the Markdown heading

#### Test: Copy All button shows toast notification

- Create an annotation
- Open panel
- Grant clipboard permissions
- Click the Copy All button
- Assert toast is visible with "Copied to clipboard!" text

#### Test: Copy All button exports all pages (not just current)

- Create annotation on home page
- Navigate to /second, create annotation there
- Open panel
- Grant clipboard permissions
- Click Copy All button
- Assert clipboard contains annotations from both pages

#### Test: Copy All button works with empty store

- Open panel
- Grant clipboard permissions
- Click Copy All button
- Assert clipboard contains the empty export message ("No annotations or
  notes yet.")
- Assert toast is visible

### 3. Optional: Add helper function (`helpers/actions.ts`)

Add a convenience function to click the export button:

```typescript
export async function clickExportButton(page: Page): Promise<void> {
  const exportBtn = shadowLocator(page, SELECTORS.exportButton);
  await exportBtn.click();
}
```

### 4. Panel button ordering test in `06-panel.spec.ts`

Add one test to verify the header button order is correct:

#### Test: Panel header buttons appear in correct order

- Open panel
- Query all buttons inside `.air-panel__actions` in the shadow DOM
- Assert order is: "+ Note", "Copy All", "Clear All"

This protects against accidental reordering of the header actions.

## Test Plan Summary

| # | Test | File | Priority |
|---|------|------|----------|
| 1 | Copy All button visible in panel | `09-export.spec.ts` | Must have |
| 2 | Copy All copies to clipboard | `09-export.spec.ts` | Must have |
| 3 | Copy All shows toast | `09-export.spec.ts` | Must have |
| 4 | Copy All exports all pages | `09-export.spec.ts` | Must have |
| 5 | Copy All works with empty store | `09-export.spec.ts` | Nice to have |
| 6 | Panel header button order | `06-panel.spec.ts` | Nice to have |

## Session Scope

This is a single-session task:
- Add the selector to `helpers/selectors.ts`
- Optionally add the helper to `helpers/actions.ts`
- Add 4–6 new tests across `09-export.spec.ts` and `06-panel.spec.ts`
- Run `npx playwright test` to verify all tests pass (existing + new)

## Entry Point

- Main component is on `main` branch with the export button already shipped
- Test repo fixture uses `astro-inline-review` from the component repo
- No fixture changes needed — the button appears automatically

## Exit Point

- All new tests pass
- All existing tests still pass
- Selector helper updated
- Commit and push
