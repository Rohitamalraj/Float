import { defineConfig } from 'drizzle-kit';
import { loadEnv } from '@float/config';

const env = loadEnv();

export default defineConfig({
  // Built JS — drizzle-kit's CJS loader does not resolve NodeNext `.js`
  // specifiers in `.ts` sources. `pnpm generate` / `migrate` build first.
  schema: './dist/schema/index.js',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: env.DATABASE_URL },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
