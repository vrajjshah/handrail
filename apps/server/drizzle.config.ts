import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are **generated files, committed to the repo**, and applied as an
 * explicit pre-start step — never by the server on boot.
 *
 * `drizzle-kit push` is deliberately not used anywhere. It diffs the live
 * database against the schema and applies whatever it decides, which means the
 * change that reaches production is one nobody reviewed. A committed `.sql`
 * file is reviewable, replayable and the same on every environment.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://handrail:handrail@localhost:5433/handrail',
  },
  strict: true,
  verbose: true,
});
