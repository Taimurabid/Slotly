# Slotly

Slotly is a booking API: service providers (consultants, tutors) publish weekly
availability and one-off blocked dates, and customers browse open slots and book
them. It's built to look like production backend code, not a tutorial project:
real validation, a database-enforced concurrency guarantee against double-booking,
timezone/DST-correct slot computation, and a test suite that exercises all of it
against a real Postgres instance rather than mocks.

**Stack:** Node.js 22, TypeScript (strict), Fastify, PostgreSQL 16 + Drizzle ORM,
Zod (shared between request validation and the generated OpenAPI spec), JWT auth
with argon2 password hashing, Vitest + Supertest, Docker, GitHub Actions CI.

**Live docs:** `https://<your-render-service>.onrender.com/docs` _(placeholder -
update once deployed; see [Deployment](#deployment))_.

## Architecture

```mermaid
flowchart LR
    Client[Client / curl / Swagger UI]

    subgraph API["Slotly API (Fastify)"]
        Auth[auth]
        Providers[providers]
        Availability[availability]
        Slots["slots\n(pure computation)"]
        Bookings[bookings]
    end

    DB[("PostgreSQL\n(bookings_no_overlap\nEXCLUDE constraint)")]
    Docs["/docs\n(Swagger UI, generated\nfrom the same Zod schemas)"]

    Client -->|HTTPS + JWT bearer| API
    Auth --> DB
    Providers --> DB
    Availability --> DB
    Slots -->|reads rules, blocks,\nconfirmed bookings| DB
    Bookings -->|pre-check via Slots,\nthen INSERT| DB
    Client -.->|browse| Docs
```

Each feature is a self-contained module under `src/modules/<feature>/` with its
own `routes` (HTTP + Zod schemas), `service` (business logic), `repository`
(Drizzle queries) and `schemas` (Zod) files. Shared code - errors, auth helpers,
pagination, timezone math - lives in `src/lib/`. Nothing outside a `service`
file talks to business logic; route handlers only validate, call a service, and
shape the HTTP response.

## Endpoints

| Method | Path                                       | Auth     | Description                                                           |
| ------ | ------------------------------------------ | -------- | --------------------------------------------------------------------- |
| GET    | `/health`                                  | -        | Liveness check; pings Postgres                                        |
| POST   | `/auth/register`                           | -        | Create an account (provider or customer)                              |
| POST   | `/auth/login`                              | -        | Log in, get an access + refresh token                                 |
| POST   | `/auth/refresh`                            | -        | Exchange a refresh token for a new pair (rotates it)                  |
| POST   | `/auth/logout`                             | -        | Revoke a refresh token                                                |
| POST   | `/providers`                               | provider | Create your provider profile                                          |
| PATCH  | `/providers/me`                            | provider | Update your provider profile                                          |
| GET    | `/providers/me`                            | provider | Get your own provider profile                                         |
| GET    | `/providers`                               | -        | List providers (paginated, searchable, filterable by price, sortable) |
| GET    | `/providers/:id`                           | -        | Get a provider by id                                                  |
| POST   | `/providers/me/availability-rules`         | provider | Add a weekly recurring availability rule                              |
| GET    | `/providers/:id/availability-rules`        | -        | List a provider's weekly rules                                        |
| DELETE | `/providers/me/availability-rules/:ruleId` | provider | Remove a rule                                                         |
| POST   | `/providers/me/blocked-slots`              | provider | Add a one-off blocked date/time range                                 |
| GET    | `/providers/:id/blocked-slots`             | -        | List a provider's blocked ranges (paginated)                          |
| DELETE | `/providers/me/blocked-slots/:blockId`     | provider | Remove a blocked range                                                |
| GET    | `/providers/:id/slots?from=&to=`           | -        | Open, bookable slots in a date range                                  |
| POST   | `/bookings`                                | customer | Book an open slot                                                     |
| GET    | `/bookings/me`                             | customer | List your own bookings (paginated, filterable by status)              |
| GET    | `/providers/me/bookings`                   | provider | List bookings against your own profile                                |
| POST   | `/bookings/:id/cancel`                     | customer | Cancel a booking (must be >24h before start)                          |

The full request/response schemas are in the generated OpenAPI doc at `/docs`
(interactive) or `/docs/json` (raw spec) once the server is running.

Every error response has the same shape:

```json
{ "error": { "code": "SLOT_NOT_AVAILABLE", "message": "This slot is not available for booking" } }
```

## Running locally

Requires Docker and Node 22 (`.nvmrc` pins the exact version).

```bash
cp .env.example .env
npm install
docker compose up -d db db-test   # dev Postgres (5432) + throwaway test Postgres (5433)
npm run db:migrate
npm run db:seed                   # optional: 3 providers, 5 customers, sample bookings
npm run dev                       # http://localhost:3000/health
```

Or run the whole stack, including migrations, in Docker:

```bash
docker compose up --build         # api (migrates then starts), db, db-test
```

`npm run db:seed` prints the accounts it creates and the shared password they
all use, so you can log in immediately via `/docs` or `curl`.

## Tests

```bash
docker compose up -d db-test
npm test                 # 107+ tests, against the real test Postgres - no mocked DB
npm run test:coverage     # coverage report (text + html + lcov)
```

Tests are split into `test/unit/` (pure functions - slot computation, timezone
conversion, password hashing - no database) and `test/integration/` (every
endpoint, through the real HTTP layer and a real Postgres instance, including
auth failures, validation errors, and a test that fires 10 concurrent booking
requests at the same slot to prove the double-booking guarantee holds under
real concurrency, not just when requests happen to arrive one at a time).

## Deployment

The `Dockerfile`'s final stage (`runtime`) is a small, non-root production
image - no TypeScript, no dev dependencies, no source. This is what both
Render and a plain `docker build .` produce by default, since it's the last
stage in the file.

**Database: [Neon](https://neon.tech) (free tier)**

1. Create a Neon project and copy the **pooled** connection string.
2. Append `?sslmode=require` if it isn't already there.

**API: [Render](https://render.com)**

1. New **Web Service** -> connect this repo -> Environment: **Docker** (Render
   builds the `Dockerfile` directly; no target needs to be specified, since
   `runtime` is already the last stage).
2. Set the **Health Check Path** to `/health`.
3. Add environment variables (see `.env.example` for what each one does):
   - `DATABASE_URL` - the Neon pooled connection string from above
   - `JWT_ACCESS_SECRET` - a long random string (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`)
   - `NODE_ENV=production`
   - `CORS_ORIGINS` - your frontend's origin(s), comma-separated
   - `JWT_ACCESS_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `RATE_LIMIT_AUTH_MAX` - optional, defaults in `.env.example` are reasonable
   - Render injects `PORT` itself; the app already reads it from the environment.
4. Before the first deploy (and after any future migration), run the migration
   against the Neon database from your machine:
   ```bash
   DATABASE_URL="<neon-pooled-url>?sslmode=require" npm run db:migrate
   ```
   This is a deliberate, separate step rather than something the container
   runs on every boot - see [Design decisions](#design-decisions).
5. Deploy. Swagger UI is live at `https://<your-service>.onrender.com/docs`.

Railway follows the same shape (Docker build, a Postgres add-on or Neon, the
same environment variables, `db:migrate` run once per schema change).

## Design decisions

**Why Fastify.** Request/response validation and serialization are built in
and schema-driven (here, from Zod via `fastify-type-provider-zod`), rather than
assembled from several separate Express middlewares. That's also what makes
`/docs` possible without a second, hand-maintained copy of the API contract:
the same Zod schemas validate requests, shape responses, and generate the
OpenAPI document. Plugin encapsulation (each `register()` call gets its own
scope unless explicitly broken out of) keeps modules from leaking decorators
into each other by accident. It's also simply fast, with a large production
track record.

**Why the exclusion constraint, not just an application-level check.** Two
customers can request the same slot close enough in time that an
application-level "is this slot free?" check passes for both before either
has written anything - that race is exactly what step 6 found: naive
`SELECT`-then-`INSERT` logic cannot close it, no matter how carefully it's
written, because the check and the write aren't atomic across two separate
requests. Postgres's `EXCLUDE USING gist` constraint on `bookings` (enabled by
`btree_gist`, see `src/db/migrations/0001_bookings_no_overlap_exclusion.sql`)
makes the database itself the authority: only one overlapping INSERT can ever
commit, full stop. The application still does a friendly pre-check first (so
the common case gets a clear, specific error), but the constraint is what
actually guarantees correctness - proven in
`test/integration/bookings-concurrency.test.ts`, which fires 10 simultaneous
booking requests at one slot and asserts exactly one succeeds. Verifying this
against the real production Docker image with genuinely concurrent OS
processes (not just `Promise.all` in one Node process) surfaced a further
subtlety: under write contention, Postgres sometimes reports a losing
transaction as `deadlock_detected` rather than `exclusion_violation` - a
documented property of GiST exclusion constraints under load, and just as
safe to treat as "lost the race," since a deadlock victim is automatically
rolled back having done no work.

**How timezones are handled.** A provider's timezone is stored as an IANA zone
name (`America/New_York`), never a fixed UTC offset, because the offset itself
changes twice a year under DST. That split shows up in the schema: a weekly
recurring rule (`availability_rules`) is a wall-clock pattern - "every Monday
at 9am local" - so it's stored as provider-local minutes-from-midnight, not a
UTC instant, because a UTC instant doesn't exist yet until you pick an actual
calendar date. A one-off block or a booking refers to one concrete span of
time, so those are stored as absolute UTC timestamps. Converting a rule into a
concrete UTC instant for a given date (`zonedTimeToUtc` in `src/lib/time.ts`)
is where DST actually gets resolved: it looks up the zone's real UTC offset at
that specific date via `Intl.DateTimeFormat`, so the same "9:00 AM" rule
correctly lands on different UTC instants on either side of a DST transition.
This is verified against real 2026 DST transition dates in both directions,
plus a southern-hemisphere zone where the transition direction is reversed.

**What I'd add next.**

- Multi-instance migration locking (a Postgres advisory lock around
  `db:migrate`), for deploying with more than one API instance at a time.
- Payments (Stripe) at booking time, with a webhook-driven booking status.
- Provider reviews/ratings, and a notification (email) on booking/cancellation.
- Recurring bookings (a customer booking the same weekly slot indefinitely).
- Structured tracing/metrics (OpenTelemetry) beyond the current request logs,
  and a load test specifically targeting the exclusion constraint's behavior
  under much higher write concurrency than the current 10-request test.
