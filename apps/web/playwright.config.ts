import { defineConfig } from '@playwright/test';

/**
 * Requires a live `apps/web` server (dev or prod) with DATABASE_URL pointed
 * at a reachable Postgres — see `e2e/README.md`. Not part of the default
 * `pnpm lint|typecheck|test` pipeline, same as the contracts fork tests.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
});
