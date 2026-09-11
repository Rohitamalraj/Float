import { expect, test } from '@playwright/test';
import { installMockWallet, testAccount } from './fixtures/mock-wallet';

/**
 * Full onboarding lifecycle against a live app + database: connect a wallet,
 * SIWE sign-in (real signature, real cookie session), complete the 4-step
 * wizard, land on the dashboard. No mocked API responses — every request
 * hits the real Next.js route handlers and Postgres.
 *
 * Requires a running `apps/web` dev/prod server with DATABASE_URL configured
 * against a reachable Postgres (see apps/web/e2e/README.md).
 */
test.describe('onboarding', () => {
  test('connect wallet, sign in, and provision a business', async ({ page, context }) => {
    await installMockWallet(context);
    await page.goto('/login');

    await page.getByRole('button', { name: /connect wallet/i }).click();
    await expect(page.getByText(testAccount.address, { exact: false })).toBeVisible();

    await page.getByRole('button', { name: /sign in with ethereum/i }).click();
    await page.waitForURL('**/onboarding', { timeout: 15_000 });

    // Step 0 — name
    const label = `e2e-${Date.now()}`;
    await page.getByPlaceholder('rosa-design').fill(label);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 1 — disclosures
    for (const checkbox of await page.locator('input[type=checkbox]').all()) {
      await checkbox.check();
    }
    await page.getByRole('button', { name: 'I understand' }).click();

    // Step 2 — accreditation (default "unknown" is fine)
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 3 — KYC submission
    await page.getByPlaceholder('data-room URL or ticket id').fill('e2e-test-reference');
    await page.getByRole('button', { name: /submit for review/i }).click();

    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Recent sweeps' })).toBeVisible();
    await expect(page.getByText(new RegExp(`^${label}\\.`))).toBeVisible();
  });

  test('an unauthenticated visit to /dashboard bounces to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/login', { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /sign in to float/i })).toBeVisible();
  });
});
