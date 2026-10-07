# Database migrations

`schema.sql` creates schema version 1. Each later change is a numbered file here,
e.g. `002_imports_and_live_data.sql` is version 2, and `SCHEMA_VERSION` in
`server/config/dbInit.ts` is raised to match.

Pending migrations run automatically when the API starts (or on `npm run db:init`), in order,
and each is recorded in `schema_migrations`. A brand-new database runs `schema.sql` and then
every migration, so it ends up identical to an upgraded one.

Rules:
- Never edit a migration that has already been shared; add a new numbered file instead.
- Write SQL that works on both MySQL 8 and MariaDB 10.4 (XAMPP). Avoid `ADD COLUMN IF NOT EXISTS`
  (MariaDB only) and MySQL-only syntax.
- MySQL commits `ALTER TABLE` immediately, so a file that fails halfway stays half-applied. The error
  names the file; fix the database by hand, or in development run `npm run db:reset`.
