# astro-inline-review-tests

Playwright acceptance test suite for [astro-inline-review](https://github.com/viv/astro-inline-review).

## Important

- **Do NOT run `tsc --noEmit`** — TypeScript is not a direct dependency. Playwright handles TS compilation internally via `@playwright/test`.
- To verify tests compile and run: `npx playwright test` (not `tsc`).
- The fixture in `fixture/` uses a `file:` dependency pointing to the sibling `../astro-inline-review` directory. Use `npm install` (not `npm ci`) in the fixture to resolve it correctly.
