import { defineConfig } from 'drizzle-kit';

/**
 * NOTE: migrations in this repo are hand written and numbered
 * (`server/sql/0000.sql` … `server/sql/NNNN.sql`). They are applied by
 * `rin db migrate`, which tracks progress in the `info.migration_version`
 * row rather than in a drizzle-kit journal.
 *
 * `out` therefore points at `sql` so generated artifacts land next to the real
 * migrations. Before relying on `drizzle-kit generate` for incremental
 * migrations, a `sql/meta/_journal.json` plus the matching snapshots have to
 * exist — without them drizzle-kit assumes an empty history and would emit a
 * full CREATE TABLE script. Until that is set up, treat `db:gen` output as a
 * reference and add new migrations by hand.
 *
 * `server/src/db/__tests__/migration-coverage.test.ts` guards the important
 * half of this: every column declared in `src/db/schema.ts` must be created by
 * some migration file.
 */
export default defineConfig({
  schema: 'src/db/schema.ts',
  out: 'sql',
  dialect: 'sqlite',
  dbCredentials: {
    url: "sqlite.db",
  },
});
