# Tasks

Structured development tracking per [`MASTER_PROJECT_INSTRUCTIONS.md`](MASTER_PROJECT_INSTRUCTIONS.md)
section 12. This is a solo project, so "In Review" and "Blocked" are kept
as categories for completeness but are typically empty.

## Completed

All nine original build steps. Each is a real git commit with its own
verification (tests + a production Docker smoke test); see
[`CHANGELOG.md`](CHANGELOG.md) for what each one actually did.

1. Scaffold, tooling, Docker, CI
2. DB schema and migrations (incl. the `bookings_no_overlap` EXCLUDE constraint)
3. Auth: register, login, refresh, logout
4. Providers and availability
5. Slot computation with DST-aware unit tests
6. Bookings, with the double-booking concurrency guarantee proven under real load
7. OpenAPI 3 spec + Swagger UI at `/docs`
8. Seed script
9. README, deployment docs, and this documentation set
10. Security audit ([`docs/security/SECURITY_AUDIT_REPORT.md`](docs/security/SECURITY_AUDIT_REPORT.md))
    and remediation of all 8 actionable findings
    ([`docs/security/SECURITY_REMEDIATION_LOG.md`](docs/security/SECURITY_REMEDIATION_LOG.md)) -
    including the zod 3→4 upgrade below, which started as a backlog item
    here and was pulled forward once the audit formally classified it as
    SEC-03.

## Backlog

Not started. Ordered roughly by what would matter most for turning this
from a portfolio API into something closer to shippable.

### Multi-instance migration locking

- **Why:** `npm run db:migrate` is a manual, separate step by design (see
  `src/db/migrate.ts`'s doc comment) specifically so concurrent instances
  never race to migrate - but nothing currently stops two _migration_ runs
  from racing against each other if triggered twice at once.
- **Scope:** wrap `migrate()` in a Postgres advisory lock
  (`pg_advisory_lock`) in `src/db/migrate.ts`.
- **Acceptance criteria:** a test that runs `db:migrate` twice concurrently
  and asserts the second call waits rather than erroring.

### Payments at booking time

- **Why:** a real booking product needs to actually charge someone.
- **Scope:** new `payments` module; Stripe PaymentIntent created alongside
  the booking; booking `status` gains a `pending_payment` state; a webhook
  handler confirms or releases the slot.
- **Dependencies:** touches `bookings.service.ts`'s `createBooking` and the
  `booking_status` enum (new migration).
- **Acceptance criteria:** a booking that isn't paid within N minutes
  releases the slot (reuses the existing cancellation/exclusion-constraint
  machinery, doesn't need a new concurrency mechanism).

### Provider reviews/ratings

- **Scope:** new `reviews` module; a review references a completed
  (`starts_at` in the past, `status = 'confirmed'`) booking, one review per
  booking.
- **Acceptance criteria:** `GET /providers/:id` includes an average rating;
  a customer can't review a booking that isn't theirs or isn't finished yet.

### Booking/cancellation email notifications

- **Scope:** an outbound-email service (Resend or similar) triggered from
  `bookings.service.ts` on create/cancel. Needs to not block the HTTP
  response - a job queue or at minimum `void` + logged failure, not an
  `await` in the request path.

### Recurring bookings

- **Why:** right now a customer books one slot at a time.
- **Scope:** a `recurring_booking_id` on `bookings`, a weekly-series
  creation endpoint that books N future occurrences, each still subject to
  the same exclusion constraint individually (no new concurrency mechanism
  needed - this is additive on top of what exists).

### Observability beyond request logs

- **Scope:** OpenTelemetry traces/metrics; a dashboard for the two numbers
  that actually matter operationally here: booking success rate and
  `SLOT_NOT_AVAILABLE` rate (a spike in the latter under low real load would
  indicate the exclusion constraint is firing more than expected, worth
  investigating).

### Higher-concurrency load test

- **Why:** the existing concurrency proof uses 10 simultaneous requests,
  matching the default `pg` pool size so every request gets a real
  connection at once. Worth a follow-up test at, say, 100-500 concurrent
  requests specifically to see how `deadlock_detected` frequency scales and
  confirm `isSlotConflict` still catches everything at that scale.

## Blocked

Nothing currently blocked.
