import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Production safety tests verify that the integration leaves zero traces
 * in the production build output. These tests build the fixture site and
 * examine the dist/ directory for any integration artifacts.
 */

const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixture');
const DIST_DIR = path.join(FIXTURE_DIR, 'dist');

test.describe('Production safety', () => {
  // Build the fixture site once before all tests in this describe block
  test.beforeAll(() => {
    execSync('npm run build', {
      cwd: FIXTURE_DIR,
      stdio: 'pipe',
      timeout: 60_000,
    });

    // Guard against false positives: if the build produced no output,
    // every test would trivially pass (empty for-of loops).
    const htmlFiles = findFiles(DIST_DIR, '.html');
    if (htmlFiles.length === 0) {
      throw new Error(
        `Production safety: build produced no HTML files in ${DIST_DIR}. ` +
          'Cannot verify production output is clean.',
      );
    }
  });

  test('no integration scripts in production build HTML', async () => {
    // Check all HTML files in dist/ for any integration script references
    const htmlFiles = findFiles(DIST_DIR, '.html');

    for (const htmlFile of htmlFiles) {
      const content = fs.readFileSync(htmlFile, 'utf-8');

      // Should not contain the integration's client script
      expect(content).not.toContain('astro-inline-review');
      expect(content).not.toContain('inline-review');
      expect(content).not.toContain('air-fab');
      expect(content).not.toContain('__inline-review');
    }
  });

  test('no shadow DOM host element in production HTML', async () => {
    const htmlFiles = findFiles(DIST_DIR, '.html');

    for (const htmlFile of htmlFiles) {
      const content = fs.readFileSync(htmlFile, 'utf-8');

      // Should not contain the shadow DOM host
      expect(content).not.toContain('astro-inline-review-host');
    }
  });

  test('no __inline-review API references in bundled JS', async () => {
    const jsFiles = findFiles(DIST_DIR, '.js');

    for (const jsFile of jsFiles) {
      const content = fs.readFileSync(jsFile, 'utf-8');

      // Should not contain any API endpoint references
      expect(content).not.toContain('__inline-review');
      expect(content).not.toContain('inline-review/api');
    }
  });

  test('no inline-review.json file operations in production', async () => {
    const jsFiles = findFiles(DIST_DIR, '.js');

    for (const jsFile of jsFiles) {
      const content = fs.readFileSync(jsFile, 'utf-8');

      // Should not contain references to the JSON storage file
      expect(content).not.toContain('inline-review.json');
    }
  });
});

/**
 * Recursively find all files with a given extension in a directory.
 */
function findFiles(dir: string, extension: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findFiles(fullPath, extension));
    } else if (entry.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}
