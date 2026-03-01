# review-loop-tests

Playwright acceptance test suite for [review-loop](https://github.com/viv/review-loop).

## Important

- **Do NOT run `tsc --noEmit`** — TypeScript is not a direct dependency. Playwright handles TS compilation internally via `@playwright/test`.
- To verify tests compile and run: `npx playwright test` (not `tsc`).
- The fixture in `fixture/` uses a `file:` dependency pointing to the sibling `../review-loop` directory. Use `npm install` (not `npm ci`) in the fixture to resolve it correctly.
