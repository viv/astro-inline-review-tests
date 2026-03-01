import { defineConfig } from 'astro/config';
import inlineReview from 'review-loop';

export default defineConfig({
  integrations: [inlineReview()],
  server: { port: 4399 },
});
