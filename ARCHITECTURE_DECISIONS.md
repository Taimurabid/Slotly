# Architecture Decisions

Short ADR-style log of the decisions behind Slotly that aren't obvious from
reading the code alone. Each entry: what was decided, what else was
considered, and why the alternative lost. See `README.md` for a one-paragraph
summary of the three decisions most worth discussing in an interview.

## 1. Fastify over Express

**Decision:** Fastify, with `fastify-type-provider-zod`.

**Why:** Request validation, response serialization, and OpenAPI generation
all need to agree on one schema. Fastify's schema-driven request lifecycle
makes a single Zod schema do all three jobs (`src/app.ts`, every
`*.routes.ts`). With Express, the same result needs three separately
maintained things (a validation middleware, a manual response shape, and a
hand-written OpenAPI doc) that can quietly drift apart. Fastify's plugin
encapsulation (`register()` creates a child scope unless broken out of) also
keeps a module's decorators from leaking into another by accident.

**Alternative considered:** Express + Zod middleware + manually maintained
OpenAPI YAML. Rejected: three sources of truth instead of one.

## 2. The database EXCLUDE constraint is the actual authority against double-booking, not application code

**Decision:** `bookings` has a Postgres `EXCLUDE USING gist` constraint
(`src/db/migrations/0001_bookings_no_overlap_exclusion.sql`), enabled by the
`btree_gist` extension. The application still pre-checks slot availability
before inserting, but that check is a UX nicety, not the guarantee.

**Why:** Two requests for the same slot can both pass a "is this slot free?"
check before either has written anything - the check and the write are not
atomic across two separate HTTP requests, no matter how the check is
written. Only the database can make the final INSERT atomic. This was
proven, not assumed: `test/integration/bookings-concurrency.test.ts` fires
10 simultaneous requests at one slot and asserts exactly one succeeds.
Running that same race against the production Docker image with genuine
separate OS processes (not just `Promise.all` in one Node process) surfaced
a real subtlety: under write contention, Postgres sometimes reports a losing
transaction as `deadlock_detected` (`40P01`) rather than `exclusion_violation`
(`23P01`). Both are now treated as "lost the race" in
`src/modules/bookings/bookings.service.ts`'s `isSlotConflict`, because a
deadlock victim is automatically rolled back having done no work - this is a
documented property of GiST exclusion constraints under load, not a flaw.

**Alternative considered:** `SELECT ... FOR UPDATE` row locking, or a
unique constraint on `(provider_id, starts_at)`. Rejected: row locking only
works if every writer takes the lock in the same order and a session length
change would silently stop protecting anything; a unique constraint on exact
start time doesn't prevent a 90-minute booking from overlapping two 45-minute
ones with different start times. An exclusion constraint on the actual
`tstzrange` is the only one of the three that is correct regardless of
session length or exact overlap shape.

## 3. Timezones: IANA zone names, and two different storage shapes for two different kinds of time

**Decision:** `provider_profiles.timezone` is an IANA zone name
(`America/New_York`), validated against the real timezone database
(`isValidTimeZone` in `src/lib/time.ts`), never a fixed UTC offset.
`availability_rules` stores provider-local minutes-from-midnight;
`blocked_slots` and `bookings` store absolute UTC timestamps.

**Why:** A fixed offset is wrong for roughly half the year wherever DST
applies. A weekly rule ("every Monday at 9am local") is a wall-clock pattern
that has no UTC instant until you pick an actual calendar date - DST is
resolved at that point, in `zonedTimeToUtc` (`src/lib/time.ts`), by looking
up the zone's real offset at that specific date via `Intl.DateTimeFormat`
rather than assuming it. A one-off block or a booking already refers to one
concrete span of time, so there's no ambiguity to resolve later - UTC is the
right storage type immediately. Verified against real 2026 DST transition
dates in both directions and a southern-hemisphere zone where the transition
direction is reversed (`test/unit/time.test.ts`, `test/unit/slots.test.ts`).

**Alternative considered:** Storing a UTC offset per provider instead of a
zone name. Rejected outright - it's wrong twice a year by construction.

## 4. Drizzle ORM over Prisma

**Decision:** Drizzle ORM with the `node-postgres` (`pg`) driver.

**Why:** The booking guarantee depends on a raw Postgres feature (`EXCLUDE
USING gist`) that no ORM's schema DSL models natively. Drizzle's generated
migrations are plain, readable, hand-editable SQL files, so adding that
constraint as a second, hand-written migration
(`0001_bookings_no_overlap_exclusion.sql`) sitting next to the generated one
is natural and git-diffable. Drizzle also doesn't impose a query-building
abstraction between the developer and SQL, which made this specific
auditable.

**Alternative considered:** Prisma. Rejected for this project specifically:
Prisma's migration files are also plain SQL, but its generated client query
API and schema DSL are a thicker, more opinionated layer, which doesn't
change what's possible here but adds more surface between "what the code
says" and "what SQL actually runs" - not a asset for a project built to be
read line-by-line in interviews.

## 5. Argon2 over bcrypt for password hashing

**Decision:** `argon2` (argon2id).

**Why:** Argon2id is the current OWASP-recommended default: memory-hard
(resists GPU/ASIC cracking in a way bcrypt, which is only CPU-hard, does
not), and winner of the Password Hashing Competition. There's no bcrypt
72-byte input truncation footgun to account for either.

**Alternative considered:** bcrypt. Rejected: older, CPU-only cost function,
and the 72-byte silent-truncation behavior is a real, recurring source of
bugs (and, if accidentally relied upon, a security weakness) in other
systems.

## 6. Rotating refresh tokens, hashed at rest

**Decision:** A refresh token is a random 48-byte value; only its SHA-256
hash is stored (`refresh_tokens.token_hash`). Every `/auth/refresh` call
revokes the token it was given and issues a new one in the same response
(`rotateRefreshToken` in `src/modules/auth/auth.service.ts`).

**Why:** A leaked database dump should not be enough to forge a session - the
hash alone is useless for that. Rotation limits how long a stolen refresh
token is valuable: reuse of an already-revoked token is detectable (it fails
immediately) and is itself a signal that a token was compromised.

**Alternative considered:** A single long-lived refresh token, checked by
equality. Rejected: a stolen token would stay valid for its entire lifetime
with no way to detect the theft.

## 7. Ownership enforced in the repository layer's `WHERE` clause, not just in the service

**Decision:** Mutating an owned resource (deleting an availability rule or
blocked slot, cancelling a booking) scopes the SQL `WHERE` clause to the
resource id **and** the caller's id, e.g. `cancelBookingById` in
`src/modules/bookings/bookings.repository.ts`: `WHERE id = ? AND customer_id
= ? AND status = 'confirmed'`.

**Why:** A service-layer check ("fetch the row, then compare `ownerId`")
is correct today but is one refactor away from being silently removed or
bypassed by a future caller that skips the service function. Putting the
ownership check directly in the query that performs the mutation means
there is no code path - today or in the future - that can act on a resource
that isn't the caller's, because the database itself won't match the row.

**Alternative considered:** Fetch-then-check-then-mutate, entirely in the
service layer. Rejected as the sole mechanism - kept as a secondary check
(for a clearer error message distinguishing "not found" from "not yours"),
but not trusted as the only line of defense.
