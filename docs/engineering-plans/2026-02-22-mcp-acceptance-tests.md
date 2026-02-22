---
generated_by: Claude Opus 4.6
generation_date: 2026-02-22
model_version: claude-opus-4-6
purpose: implementation_plan
status: session_1_complete
human_reviewer: matthewvivian
tags: [mcp, acceptance-tests, playwright, agent-integration]
---

# MCP Server & Resolved/Reply UI — Acceptance Test Plan

## Context

The `astro-inline-review` component now includes an MCP server (Sessions 1–7 of the MCP engineering plan) with six tools, data model extensions (`resolvedAt`, `replies`), and browser UI updates to display resolved state and agent replies. No acceptance tests exist for any of this.

### What Changed in the Component

**MCP server** (`dist/mcp/server.js`):
- Six tools: `list_annotations`, `list_page_notes`, `get_annotation`, `get_export`, `resolve_annotation`, `add_agent_reply`
- stdio transport, `--storage` CLI arg, `.mcp.json` auto-discovery
- Reads/writes the same `inline-review.json` as the REST API

**Data model** (new optional fields on annotations):
- `resolvedAt?: string` — ISO 8601 timestamp when marked resolved
- `replies?: AgentReply[]` — array of `{ message: string, createdAt: string }`

**Browser UI** (panel rendering):
- Resolved annotations show a green checkmark badge and dimmed/strikethrough styling
- Agent replies display beneath annotations with "Agent:" prefix and different styling
- Resolved highlights have distinct styling (reduced opacity or different colour)

**Markdown export**:
- Resolved annotations show ` ✅ [Resolved]` suffix
- Agent replies shown as `> **Agent:** reply text` blockquotes

## New Test File: `14-mcp-and-resolved.spec.ts`

These tests exercise the MCP features through the browser UI and REST API. The MCP server itself is unit-tested in the component repo — acceptance tests focus on the visible outcome (resolved UI, agent replies in panel, export format).

### Approach

The acceptance tests don't need to spawn the MCP server directly. Instead, they can:
1. **Write directly to `inline-review.json`** with `resolvedAt` and `replies` fields pre-set (simulating what the MCP server does)
2. **Use the REST API** via `page.evaluate(fetch(...))` to create annotations, then modify `inline-review.json` directly to add resolved/reply data
3. **Verify the browser UI** shows the correct resolved state and agent replies after reload

This is the right level of abstraction — the MCP server's correctness is covered by unit tests, and the acceptance tests verify the browser correctly renders the data those tools produce.

### Prerequisites

No fixture changes needed. The browser UI reads from `inline-review.json` via the REST API, and the existing fixture site works as-is.

### New Helpers Needed

#### `helpers/actions.ts` additions

```typescript
/**
 * Write a pre-built review store to inline-review.json.
 * Used to simulate MCP server writes (resolvedAt, replies).
 */
export function writeReviewStore(store: {
  version: 1;
  annotations: Array<Record<string, unknown>>;
  pageNotes: Array<Record<string, unknown>>;
}): void {
  fs.writeFileSync(REVIEW_JSON_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Read the review store and return a parsed object.
 */
export function readReviewStore(): {
  version: number;
  annotations: Array<Record<string, unknown>>;
  pageNotes: Array<Record<string, unknown>>;
} | null {
  try {
    const content = fs.readFileSync(REVIEW_JSON_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
```

#### Test data factory

```typescript
/**
 * Create a minimal annotation object for test fixtures.
 */
function makeAnnotation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: `test-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type: 'text',
    pageUrl: '/',
    pageTitle: 'Home',
    selectedText: 'quick brown fox',
    note: 'Test annotation',
    createdAt: now,
    updatedAt: now,
    range: {
      startXPath: '/html[1]/body[1]/main[1]/p[1]/text()[1]',
      startOffset: 4,
      endXPath: '/html[1]/body[1]/main[1]/p[1]/text()[1]',
      endOffset: 19,
      selectedText: 'quick brown fox',
      contextBefore: 'The ',
      contextAfter: ' jumps over',
    },
    ...overrides,
  };
}
```

The XPath/offset values should be calibrated to the actual fixture content in a first pass.

---

## Test Scenarios

### Group A: Resolved Annotations in Panel

#### A1. Resolved annotation shows checkmark badge in panel

- Write `inline-review.json` with one annotation that has `resolvedAt` set
- Navigate to the page, open panel
- Assert the annotation item shows a resolved indicator (checkmark or "[Resolved]" text)

**Priority**: Must have

#### A2. Resolved annotation has dimmed/distinct styling

- Write `inline-review.json` with one resolved and one unresolved annotation
- Open panel
- Assert the resolved annotation has visually distinct styling (e.g., reduced opacity, strikethrough)
- Assert the unresolved annotation has normal styling

**Priority**: Must have

#### A3. Resolved annotation shows resolvedAt timestamp

- Write `inline-review.json` with a resolved annotation
- Open panel
- Assert the resolved timestamp is displayed in a human-readable format

**Priority**: Nice to have

### Group B: Agent Replies in Panel

#### B1. Single agent reply displays beneath annotation

- Write `inline-review.json` with an annotation that has one reply
- Open panel
- Assert the reply text is visible under the annotation
- Assert it has an "Agent:" prefix or similar labelling

**Priority**: Must have

#### B2. Multiple agent replies display in chronological order

- Write `inline-review.json` with an annotation that has two replies (different timestamps)
- Open panel
- Assert both replies are visible in the correct order (earliest first)

**Priority**: Must have

#### B3. Agent replies have distinct styling from reviewer notes

- Write `inline-review.json` with an annotation that has both a note and a reply
- Open panel
- Assert the reviewer's note and the agent's reply are visually distinguishable (different background, indentation, or prefix)

**Priority**: Nice to have

### Group C: Resolved Highlights

#### C1. Resolved annotation highlight has distinct styling

- Write `inline-review.json` with one resolved text annotation (valid XPath for fixture content)
- Navigate to the page
- Assert the `<mark>` highlight exists
- Assert it has a different background colour or opacity from the default highlight

**Priority**: Must have

#### C2. Unresolved and resolved highlights coexist

- Write `inline-review.json` with one resolved and one unresolved annotation
- Navigate to the page
- Assert both highlights exist
- Assert they have different visual styles

**Priority**: Must have

### Group D: Export with Resolved & Replies

#### D1. Export includes [Resolved] indicator

- Create an annotation via browser, then write `resolvedAt` into `inline-review.json`
- Fetch export via `GET /__inline-review/api/export`
- Assert export contains `✅ [Resolved]` on the resolved annotation line

**Priority**: Must have

#### D2. Export includes agent replies as blockquotes

- Write `inline-review.json` with an annotation that has replies
- Fetch export via API
- Assert export contains `> **Agent:** <reply text>` for each reply

**Priority**: Must have

#### D3. Export clipboard copy includes resolved and reply data

- Write store with resolved annotations and replies
- Trigger clipboard export (keyboard shortcut or Copy All button)
- Assert clipboard content includes resolved indicator and agent reply text

**Priority**: Nice to have

### Group E: REST API Compatibility

#### E1. GET /annotations returns resolvedAt and replies fields

- Write `inline-review.json` with resolved annotations and replies
- `fetch('/__inline-review/api/annotations')` via `page.evaluate`
- Assert the response JSON includes `resolvedAt` and `replies` fields

**Priority**: Must have

#### E2. PATCH /annotations/:id does not clear resolvedAt or replies

- Write `inline-review.json` with a resolved annotation that has replies
- PATCH the annotation to update the note
- Read back from `inline-review.json`
- Assert `resolvedAt` and `replies` are preserved (not wiped by the PATCH)

**Priority**: Must have

### Group F: Edge Cases

#### F1. Annotation with replies but not resolved renders correctly

- Write store with annotation that has `replies` but no `resolvedAt`
- Open panel
- Assert replies are shown but no resolved indicator

**Priority**: Must have

#### F2. Annotation with no replies and no resolvedAt renders as before

- Write store with a plain annotation (no `resolvedAt`, no `replies`)
- Open panel
- Assert it renders identically to the pre-MCP behaviour (no extra UI elements)

**Priority**: Must have

#### F3. Empty replies array renders as no replies

- Write store with `replies: []`
- Open panel
- Assert no reply section is shown

**Priority**: Nice to have

#### F4. Resolved element annotation shows resolved state

- Write store with a resolved element annotation
- Navigate to the page
- Assert the element outline highlight exists with resolved styling
- Open panel, assert resolved indicator in element annotation item

**Priority**: Nice to have

---

## Test Plan Summary

| # | Test | Group | Priority |
|---|------|-------|----------|
| A1 | Resolved annotation shows checkmark in panel | Panel | Must have |
| A2 | Resolved annotation has distinct styling | Panel | Must have |
| A3 | Resolved annotation shows timestamp | Panel | Nice to have |
| B1 | Single agent reply displays | Panel | Must have |
| B2 | Multiple replies in chronological order | Panel | Must have |
| B3 | Replies have distinct styling | Panel | Nice to have |
| C1 | Resolved highlight has distinct style | Highlights | Must have |
| C2 | Resolved and unresolved highlights coexist | Highlights | Must have |
| D1 | Export includes [Resolved] indicator | Export | Must have |
| D2 | Export includes agent reply blockquotes | Export | Must have |
| D3 | Clipboard export includes resolved/reply | Export | Nice to have |
| E1 | API returns resolvedAt and replies | API | Must have |
| E2 | PATCH preserves resolvedAt and replies | API | Must have |
| F1 | Replies without resolved | Edge cases | Must have |
| F2 | Plain annotation unchanged | Edge cases | Must have |
| F3 | Empty replies array | Edge cases | Nice to have |
| F4 | Resolved element annotation | Edge cases | Nice to have |

**Total**: 17 scenarios (11 must-have, 6 nice-to-have)

## Sessions

### Session 1: Test Infrastructure & Panel Tests (A1–A3, B1–B3, F1–F3)

**Goal**: Set up test data factories and helpers, implement all panel rendering tests.

**Entry state**: Test repo on main, component updated with MCP features.

**Exit state**: `14-mcp-and-resolved.spec.ts` created with panel tests passing. Helpers added. Committed.

**Steps**:
1. Add `writeReviewStore` and `readReviewStore` helpers to `helpers/actions.ts`
2. Create `14-mcp-and-resolved.spec.ts` with test data factory
3. Calibrate XPath values against actual fixture HTML content
4. Implement Group A tests (resolved in panel)
5. Implement Group B tests (agent replies in panel)
6. Implement Group F edge case tests (F1–F3)
7. Run full suite to verify no regressions

### Session 2: Highlights, Export & API Tests (C1–C2, D1–D3, E1–E2, F4)

**Goal**: Implement highlight styling tests, export format tests, and API compatibility tests.

**Entry state**: Session 1 committed. Panel tests passing.

**Exit state**: All scenarios implemented and passing. Full suite green. Committed.

**Steps**:
1. Implement Group C tests (resolved highlight styling)
2. Implement Group D tests (export format)
3. Implement Group E tests (API compatibility)
4. Implement F4 (resolved element annotation)
5. Run full suite
6. Verify total test count and all passing

## Entry Point

- Component repo: MCP features on `main`, pushed (commit `6122c27`)
- Test repo: `main` branch, fixture uses linked/installed `astro-inline-review`
- May need `npm install` or `npm link` to pick up latest component changes

## Exit Point

- All 17 scenarios passing
- All existing 13 test files still passing
- No fixture changes needed (data injected via `writeReviewStore`)
- Committed and pushed
