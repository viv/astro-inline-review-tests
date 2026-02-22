# astro-inline-review-tests

[![Acceptance Tests](https://github.com/viv/astro-inline-review-tests/actions/workflows/ci.yml/badge.svg)](https://github.com/viv/astro-inline-review-tests/actions/workflows/ci.yml)

Playwright acceptance test suite for [astro-inline-review](https://github.com/viv/astro-inline-review), the bridge between human reviewers and coding agents for Astro sites.

This repo is kept separate from the main package so the acceptance tests can exercise the integration as an external consumer would, installing from npm and running against a real Astro dev server.

## Prerequisites

- Node.js >= 18
- The main `astro-inline-review` repo cloned as a sibling directory (for local development)

## Setup

```bash
npm install
npx playwright install chromium
```

The test fixture in `fixture/` is a minimal Astro site that uses `astro-inline-review` as a dev dependency. During local development it references the sibling directory via a file dependency.

## Running Tests

```bash
npm test              # headless
npm run test:ui       # interactive Playwright UI
```

## Test Structure

| File | Coverage |
|------|----------|
| `01-integration.spec.ts` | Integration lifecycle, dev-only activation |
| `02-fab.spec.ts` | Floating action button behaviour |
| `03-selection.spec.ts` | Text selection and annotation creation |
| `04-highlights.spec.ts` | Highlight rendering and restoration |
| `05-persistence.spec.ts` | Annotation persistence across reloads |
| `06-panel.spec.ts` | Review panel UI and interactions |
| `07-page-notes.spec.ts` | Page note CRUD |
| `08-multi-page.spec.ts` | Cross-page annotation scoping |
| `09-export.spec.ts` | Markdown export |
| `10-keyboard-shortcuts.spec.ts` | Keyboard shortcut handling |
| `11-edge-cases.spec.ts` | Edge cases and error recovery |
| `12-production-safety.spec.ts` | Zero traces in production builds |
| `13-element-annotations.spec.ts` | Element annotation (Alt+click) functionality |

## Licence

[MIT](LICENSE)
