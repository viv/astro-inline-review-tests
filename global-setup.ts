import fs from 'node:fs';
import path from 'node:path';

/**
 * Runs once before the web server starts.
 * Removes stale inline-review.json from previous test runs to prevent
 * JSON parse warnings during server startup.
 */
export default function globalSetup(): void {
  const reviewJson = path.resolve(__dirname, 'fixture', 'inline-review.json');
  try {
    fs.unlinkSync(reviewJson);
  } catch {
    // File doesn't exist — that's fine
  }
}
