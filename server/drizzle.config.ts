import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are numbered by hand (`server/sql/0000.sql` … `NNNN.sql`) and
 * applied by `rin db migrate`, which tracks progress in the `info.migration_version`
 * row rather than in a drizzle-kit journal.
 *
 * `out` points at `sql` so generated artifacts land next to the real migrations.
 * `sql/meta/` now carries a journal covering every existing migration plus a
 * `0012_snapshot.json` describing the current schema state, so `drizzle-kit
 * generate` produces incremental migrations from `0013` onwards instead of a
 * full CREATE TABLE script.
 *
 * Two naming conventions coexist by design: hand written files are `0013.sql`,
 * drizzle-kit emits `0013_random_words.sql`. Both work because the migrator
 * only reads the leading digits of the file name.
 *
 * `server/src/db/__tests__/migration-coverage.test.ts` guards the other half:
 * every column declared in `src/db/schema.ts` must be created by some migration.
 */
export default defineConfig({
  schema: 'src/db/schema.ts',
  out: 'sql',
  dialect: 'sqlite',
  dbCredentials: {
    url: "sqlite.db",
  },
});
