# Changelog

All notable changes to this project are recorded here. Dates reflect when
work was committed; version numbers follow `package.json`.

## [0.1.0] - 2026-11-17

Initial build, done in nine incremental steps (see git history for the
full commit-by-commit record).

### Added

- Project scaffold: Fastify + TypeScript (strict), Zod request validation,
  Docker (multi-stage build) and GitHub Actions CI.
- Database schema (Drizzle ORM, Postgres 16): `users`, `provider_profiles`,
  `availability_rules`, `blocked_slots`, `bookings`, `refresh_tokens`. A
  `bookings_no_overlap` EXCLUDE constraint (`btree_gist`) that makes
  double-booking impossible at the database level, independent of
  application code.
- Auth: register, login, refresh (rotating), logout. JWT access tokens,
  argon2 password hashing, per-route rate limiting on all four endpoints.
- Providers: create/edit own profile; public paginated, searchable,
  filterable, sortable provider directory; public provider detail.
- Availability: weekly recurring rules and one-off blocked date ranges,
  public to read, owner-only to write, ownership enforced in the
  repository's `WHERE` clause.
- Slot computation (`GET /providers/:id/slots`): pure, unit-tested function
  that expands weekly rules into concrete UTC slots per calendar date,
  resolving DST by looking up the provider's timezone offset at that
  specific date, then subtracts anything overlapping a confirmed booking,
  a block, or the past.
- Bookings: book an open slot, list your own bookings (customer) or
  bookings against your profile (provider), cancel (>24h before start).
  Verified double-booking is impossible under genuine concurrency, both
  in-process (`Promise.all`) and against the real production Docker image
  with separate OS-level processes.
- OpenAPI 3 document generated from the same Zod schemas that validate
  requests, served interactively at `/docs`.
- Seed script (`npm run db:seed`): 3 providers, 5 customers, realistic
  weekly availability, one blocked day per provider, 6 bookings.
- README with architecture diagram, full endpoint table, local/Docker run
  instructions, test instructions, and Render + Neon deployment steps.

### Fixed

- `npm run db:migrate` failed with a misleading `JWT_ACCESS_SECRET`
  validation error, because it loaded the app's full environment schema
  instead of just the one variable it actually needs (`DATABASE_URL`).
- The production Docker image crashed with `EACCES` reading `package.json`
  as the non-root `node` user, because that file is copied straight from
  the host build context and kept the host's restrictive file permissions;
  every other file in that stage comes from an earlier root-run build
  stage and didn't have the problem. Fixed with `COPY --chown=node:node`.
- Booking requests that lost a race for the same slot under heavy write
  contention sometimes surfaced as a bare `500` instead of a clean `409`,
  because Postgres can report a losing transaction as `deadlock_detected`
  rather than `exclusion_violation` when many concurrent inserts target an
  overlapping GiST-indexed range. Both codes are now treated the same way.
- `seed.ts` ran its destructive wipe-and-reseed unconditionally at module
  load, so merely importing it (e.g. to unit-test its date-math helper)
  would trigger a full database wipe. Added an `import.meta.url` guard so
  it only runs when executed directly.
