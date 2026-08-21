import type { Config } from 'drizzle-kit';

/** `pnpm db:generate` writes the migration; `pnpm db:migrate` applies it. */
export default {
  schema: './packages/store/src/schema.ts',
  out: './packages/store/drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env['DATABASE_URL'] ?? '' },
} satisfies Config;
