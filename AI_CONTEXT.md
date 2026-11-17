# AI Context

Orientation for any AI agent (or human) picking up this repo without the
history of how it was built. Read this before touching code; see
`MASTER_PROJECT_INSTRUCTIONS.md` section 11 for the general rules this
project follows.

## What this is

A booking REST API (Node 22, TypeScript strict, Fastify, Postgres via
Drizzle). Providers publish availability; customers book slots. It's a
portfolio project meant to be read closely, not a throwaway demo - every
module is built the way the rest of the codebase is built, not "good enough
to pass once."

Start with `README.md` (overview, architecture, endpoints, how to run
it), then `ARCHITECTURE_DECISIONS.md` (why things are the way they are),
then `TASKS.md` (what isn't done yet).

## The one thing to internalize before changing anything

**The database is the authority for the double-booking guarantee, not
application code.** `bookings` has a Postgres `EXCLUDE USING gist`
constraint. If you're tempted to "simplify" `bookings.service.ts`'s
pre-check-then-insert pattern into just a pre-check, or just an insert with
a try/catch, read `ARCHITECTURE_DECISIONS.md` entry 2 first - both halves
exist on purpose, and removing either one reintroduces a real race
condition that the existing test suite is specifically built to catch.

## Repo conventions (follow these, don't invent new ones)

- **Module shape:** `src/modules/<feature>/` = `<feature>.routes.ts` (HTTP +
  Zod schemas wiring), `<feature>.service.ts` (business logic - the only
  place that should be throwing `AppError` or doing anything non-trivial),
  `<feature>.repository.ts` (Drizzle queries, nothing else), `<feature>.schemas.ts`
  (Zod). A new feature follows this exact shape.
- **Errors:** services `throw AppError.xxx(...)`; never format an error
  response by hand. See `ERROR_HANDLING.md` for the full catalog and where
  to add a new code.
- **Ownership checks on mutations:** scope the SQL `WHERE` clause to the
  resource id _and_ the caller's id (see any `delete*`/`cancel*` function in
  a `*.repository.ts`). Don't write "fetch then compare in JS" as the only
  check.
- **Timezones:** a provider's timezone is an IANA name, validated with
  `isValidTimeZone`. A recurring weekly pattern (`availability_rules`) is
  provider-local minutes-from-midnight. Anything that refers to one actual
  instant (`blocked_slots`, `bookings`) is absolute UTC. Don't "simplify" a
  UTC offset into either of these - see `ARCHITECTURE_DECISIONS.md` entry 3.
- **Tests run against a real Postgres, never a mock.** `test/unit/` is for
  pure functions only (no `db`, no network). Everything that touches the
  database is in `test/integration/`, built with `buildApp()` +
  `supertest`, the same way every existing integration test is built.
- **Before considering any change done:** `npm run format && npm run lint
&& npm run typecheck && npm test`, all clean. If the change touches
  Docker, routing, or anything environment-sensitive, also actually build
  and run the production image and hit it - this codebase has already
  caught two real bugs (a file-permission issue, a deadlock-code mismatch)
  that only showed up in the real container, not in dev or in tests.

## Things that look like bugs but aren't

- `db:migrate` and `db:seed` read `process.env.DATABASE_URL` directly
  instead of the app's `loadEnv()` - deliberate, so they don't need
  `JWT_ACCESS_SECRET` or any other unrelated app config to run.
- `seed.ts` computes booking dates relative to "today" rather than using
  fixed dates - deliberate, so the seed stays valid (and past the 24-hour
  cancellation cutoff) no matter when it's run, not just on the day it was
  written.
- `app.jwt.sign(...)` is called without `await` - it's synchronous in
  `@fastify/jwt`, not a Promise. ESLint's `await-thenable` rule will catch
  it if this regresses.

## What's intentionally not here

No UI, no multi-service architecture, no Kubernetes, no payment processing
yet. See `TASKS.md` for what's deliberately deferred and why.
