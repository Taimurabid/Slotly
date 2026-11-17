# Security Audit Report — Slotly

|                    |                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Date**           | 2026-11-17                                                                                                                                                                     |
| **Auditor**        | AI agent (Claude), acting as application security reviewer                                                                                                                     |
| **Repository**     | https://github.com/Taimurabid/Slotly (private)                                                                                                                                 |
| **Commit audited** | `bc7321e` ("Apply UPEF documentation framework...")                                                                                                                            |
| **Related docs**   | [`SECURITY_POLICY.md`](../../SECURITY_POLICY.md), [`ARCHITECTURE_DECISIONS.md`](../../ARCHITECTURE_DECISIONS.md), [`SECURITY_REMEDIATION_LOG.md`](SECURITY_REMEDIATION_LOG.md) |

> **Status update (2026-11-17, same day):** all 8 actionable findings below
> (SEC-01 through SEC-04, SEC-06 through SEC-09) have since been fixed and
> verified. This report is left as originally written - it's the record of
> what the audit found at the time, not a running status page. For current
> status, see [`SECURITY_REMEDIATION_LOG.md`](SECURITY_REMEDIATION_LOG.md).

## Executive Summary

Slotly is a small, single-service REST API (Fastify + Postgres) with no
frontend, no payment processing, no file uploads, and no multi-tenant data
model beyond per-user ownership. The codebase shows consistently good
baseline practice: parameterized queries throughout (no raw SQL
concatenation anywhere), explicit allow-listed response shaping on every
endpoint (no accidental field leakage, no mass-assignment path), ownership
enforced in the SQL `WHERE` clause of every mutation rather than only in
application logic, argon2id password hashing, rotating hashed refresh
tokens, and a database-level constraint (not just application code) that
makes the core business invariant - no double-booking - actually impossible
to violate.

One finding is rated **HIGH**: the seed script (`npm run db:seed`)
unconditionally deletes all `users` and `bookings` rows with no environment
guard, meaning it would destroy a production database if ever run against
production credentials by mistake. No **CRITICAL** findings (no remotely
exploitable path to data compromise was found). Several **MEDIUM**/**LOW**
findings are configuration hardening opportunities, not confirmed
exploitable vulnerabilities as currently deployed (there is no live
production deployment yet). One **MEDIUM**-equivalent finding is a specific,
named dependency vulnerability in a production package.

This audit does not certify the application as secure. It reports what was
checked, what was found, and what remains unverified - see
[Testing Limitations](#testing-limitations).

## Audit Scope

**Inspected:**

- All application source (`src/**`) - every module (auth, providers,
  availability, slots, bookings), `src/lib/*`, `src/config/env.ts`,
  `src/app.ts`, `src/server.ts`, `src/db/*` (schema, migrations, client,
  migrate script, seed script).
- Database schema and both migrations, including the exclusion constraint.
- Dependency manifest (`package.json`, `package-lock.json`) via `npm audit`.
- Docker configuration (`Dockerfile`, `docker-compose.yml`, `.dockerignore`).
- CI pipeline (`.github/workflows/ci.yml`).
- Environment/configuration handling (`.env.example`, `src/config/env.ts`).
- Full git history, for secrets ever committed (not just the current tree).
- Live behavioral testing against a running local instance: SQL injection
  attempts, mass-assignment attempts, IDOR attempts, rate-limit triggering.
- The existing automated test suite (107 tests) as corroborating evidence
  where it directly covers a security property (ownership checks, auth
  failures, the concurrency guarantee).

**Excluded (not applicable to this project):**

- Frontend/XSS/CSP/clickjacking - there is no frontend.
- File upload security - the application has no file upload functionality.
- Payment/financial security - the application has no payment integration.
- Third-party webhook verification - the application has no webhooks.
- Multi-tenant isolation beyond per-user ownership - there is no
  organization/tenant concept.
- Infrastructure security of a live deployment - Slotly is not yet deployed
  to Render/Neon; `README.md` documents the intended deployment but no live
  instance exists to test against.
- Container/orchestration security beyond the single `Dockerfile` - no
  Kubernetes or similar is used.

## Methodology

- **Static code review**: manual, file-by-file reading of every module and
  every security-relevant code path (auth, authorization checks, query
  construction, error handling, logging).
- **Dependency scanning**: `npm audit` (full and `--omit=dev`), and manual
  cross-reference of the dependency tree (`npm ls`) to confirm which
  packages are reachable in the production build.
- **Secret scanning**: `git log --all -p` grepped for common credential
  patterns (AWS keys, private key headers, Stripe keys, credentialed
  connection strings); `git log --all --diff-filter=A --name-only` for
  suspicious filenames ever added.
- **Dynamic/behavioral testing**: a live local instance (dev server +
  Docker Postgres) was actually exercised with `curl`, not just read as
  code - SQL injection payloads in both a query parameter and a JSON body
  field, mass-assignment payloads (extra fields in a create request),
  rate-limit triggering, and DB-state verification after each (`psql`
  queries to confirm no actual effect).
- **Automated test suite as evidence**: the existing 107-test suite was
  reviewed for which security properties it actually proves (e.g. "customer
  B cannot cancel customer A's booking" has a dedicated passing test) versus
  which properties are only asserted by this audit's manual testing.
- Standards referenced: OWASP Top 10 (2021), OWASP API Security Top 10
  (2023), general ASVS-style categories (authentication, session
  management, access control, input validation, cryptography).

## Findings Summary

| Severity      | Count |
| ------------- | ----- |
| Critical      | 0     |
| High          | 1     |
| Medium        | 2     |
| Low           | 4     |
| Informational | 5     |

## Detailed Findings

### SEC-01 — Seed script performs an unconditional, unguarded destructive wipe

**Severity:** HIGH
**Affected:** `src/db/seed.ts`, lines 34-48 (`main()`)

**Technical explanation:** `main()` reads `DATABASE_URL` directly from the
environment with no check on `NODE_ENV`, no confirmation prompt, and no
safety flag, then immediately runs `db.delete(bookings)` followed by
`db.delete(users)` - which cascades (via `ON DELETE CASCADE`) to
`provider_profiles`, `availability_rules`, `blocked_slots`, and
`refresh_tokens`. This deletes every row in every table except migration
bookkeeping, unconditionally, every time the script runs.

**Attack/failure scenario:** This is not externally exploitable (no API
endpoint triggers it), but it is a serious operational-security gap. Any of
the following would cause irreversible production data loss: a developer
running `npm run db:seed` locally with a `.env` that still points at the
production `DATABASE_URL` from a previous session; a CI/CD step or
deployment script that runs seeding as part of a release and has
`DATABASE_URL` resolved to production by a misconfigured environment
variable; a copy-pasted command from documentation run against the wrong
shell session. This class of incident (an unguarded seed/reset script run
against production) is one of the most common real-world causes of
complete data-loss incidents in small teams.

**Business impact:** Total, immediate, irreversible loss of all user
accounts and all bookings (short of a separate database backup/PITR, which
is not yet part of this project - see `TASKS.md`).

**Evidence:**

```ts
// src/db/seed.ts, inside main()
await db.delete(bookings);
await db.delete(users);
```

No preceding check of any kind. Confirmed by direct code reading; not
executed against any real data as part of this audit.

**Recommended remediation:** Refuse to run when `NODE_ENV === 'production'`
unless an explicit, separate opt-in is provided (e.g. a `--force` CLI flag
or a distinct `ALLOW_SEED_DESTRUCTIVE_RESET=true` environment variable that
would never be set in a real deployment's environment config), and print a
clear warning either way before deleting anything.

**Verification procedure:** A test asserting that calling `main()` with
`NODE_ENV=production` and no override throws before issuing any `DELETE`,
and that the existing data is unchanged afterward.

---

### SEC-02 — `CORS_ORIGINS` has no validation preventing a wildcard, combined with `credentials: true`

**Severity:** MEDIUM
**Affected:** `src/config/env.ts` (`CORS_ORIGINS` schema), `src/app.ts` (CORS registration)

**Technical explanation:** `CORS_ORIGINS` is parsed as a comma-separated
list with no validation rejecting the literal string `*`. `@fastify/cors`
(confirmed by reading its source, `node_modules/@fastify/cors/index.js`)
specifically detects `*` anywhere inside an array-valued `origin` option
and collapses the whole policy to allow-all-origins. The app registers CORS
with `credentials: true` unconditionally. If an operator ever sets
`CORS_ORIGINS=*` (or includes `*` alongside real origins) in a production
environment - a plausible copy-paste or "just get it working" mistake -
the API would advertise `Access-Control-Allow-Origin: *` with
`Access-Control-Allow-Credentials: true` simultaneously.

**Why this is MEDIUM, not HIGH/CRITICAL:** Authentication here is a bearer
token attached explicitly by client JavaScript (`Authorization` header),
not a cookie the browser attaches automatically. Modern browsers also
reject the exact combination of a wildcard `Access-Control-Allow-Origin`
with `Access-Control-Allow-Credentials: true` for credentialed requests,
which provides a second, browser-enforced layer that would block the most
direct exploitation path in compliant browsers. The realistic residual risk
is non-browser clients and any future change that moves auth to a cookie.

**Attack scenario:** If a future change introduces cookie-based session
auth without revisiting this CORS configuration, and `CORS_ORIGINS` is
simultaneously misconfigured to `*`, any website could issue credentialed
requests on behalf of a logged-in user.

**Evidence:** `node_modules/@fastify/cors/index.js:141` -
`if (Array.isArray(opts.origin) && opts.origin.indexOf('*') !== -1) { corsOptions.origin = '*' }`.

**Recommended remediation:** Add a Zod `.refine()` on `CORS_ORIGINS` in
`src/config/env.ts` that rejects a literal `*` entry, failing fast at boot
(consistent with how `JWT_ACCESS_SECRET`'s length is already enforced at
boot) rather than allowing a dangerous value to silently take effect.

**Verification procedure:** A unit test asserting `loadEnv()` throws when
`CORS_ORIGINS` contains `*`.

---

### SEC-03 — Named production dependency vulnerability: `zod <4.6.6`

**Severity:** MEDIUM (treated as a release-blocker-track item, not ignored)
**Affected:** `package.json` (`zod@^3.24.1`, `fastify-type-provider-zod@^4.0.2`)

**Technical explanation:** `npm audit --omit=dev` reports `zod <4.6.6` -
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
a memory-exhaustion issue when validating oversized constrained
collections - as a high-severity finding in a production dependency. Zod
validates every request body, query string, and route param in this
application, so the vulnerable code path is reachable from untrusted input,
not merely present in an unused corner of a dependency.

**Why MEDIUM and not HIGH here specifically:** Exploiting it to meaningful
effect would still compete with Fastify's own default 1 MB request body
limit, which already bounds how much data can reach zod in a single
request; this narrows, but does not eliminate, the practical DoS surface
(repeated requests at the body-size ceiling could still be used to apply
sustained memory pressure).

**Recommended remediation:** Upgrade `zod` (3→4) and
`fastify-type-provider-zod` (4→7, which requires zod ≥4.1.5) together. This
is a real breaking change requiring a review pass across every
`*.schemas.ts` file, not a patch-level bump - already scoped with
acceptance criteria in `TASKS.md`, not newly identified by this audit but
confirmed and escalated into the formal finding list here.

**Verification procedure:** `npm audit --omit=dev` reports zero findings;
full test suite and OpenAPI generation (`/docs/json`) still pass after the
upgrade.

---

### SEC-04 — No account lockout or anomaly detection on repeated failed logins

**Severity:** LOW
**Affected:** `src/modules/auth/auth.routes.ts`, `/auth/login`

**Technical explanation:** `/auth/login` is rate-limited at the IP level
(`RATE_LIMIT_AUTH_MAX`, default 10/minute), which slows but does not stop a
distributed or slow-and-low credential-stuffing attempt against a specific
account, since the limit is per-IP, not per-account.

**Attack scenario:** An attacker with access to many IPs (a small botnet, or
simply patience) can attempt unlimited password guesses against one
specific email address, bounded only by how many requests they're willing
to spread across time and source IPs.

**Recommended remediation:** Track failed attempts per-account (not just
per-IP) and apply an increasing delay or temporary lock after N consecutive
failures, resetting on success. This is a real but genuinely lower-impact
gap given argon2id's cost already makes brute force slow per-attempt, and
is appropriately deferred rather than urgent for a project at this stage.

**Verification procedure:** A test asserting that repeated failed logins for
one account, from varying source IPs, are eventually throttled regardless
of IP.

---

### SEC-05 — No self-service password reset flow

**Severity:** LOW (informational-leaning; absence of a feature, not a flaw in one)
**Affected:** `src/modules/auth/` (entire module - no such endpoint exists)

**Technical explanation:** There is no `/auth/forgot-password` or
equivalent. A user who forgets their password has no recovery path. This
is explicitly called out because OWASP singles out password-reset flows as
a common vulnerability source - the correct note here is that the
vulnerability class doesn't exist because the feature doesn't exist yet,
not that an implementation was reviewed and found safe.

**Recommended remediation:** When built, follow the standard safe pattern -
a single-use, time-limited, hashed-at-rest reset token, generic success
response regardless of whether the email exists (matching the existing
login/register pattern already used elsewhere in this codebase), and
invalidate all existing refresh tokens for the account when a password
actually changes.

---

### SEC-06 — Refresh tokens are not bound to a device/IP; no "log out everywhere"

**Severity:** LOW
**Affected:** `src/modules/auth/auth.service.ts`

**Technical explanation:** A refresh token, once issued, is valid from any
network location until it's rotated or its 30-day TTL expires. There is no
endpoint to revoke all of a user's refresh tokens at once (e.g. "I think my
account is compromised, log me out everywhere").

**Recommended remediation:** Add a `revokeAllRefreshTokensForUser(userId)`
function and a `/auth/logout-all` endpoint; consider recording a
`user_agent`/`ip` on issuance for display ("active sessions") even without
hard-binding to them.

---

### SEC-07 — `page` query parameter has no upper bound

**Severity:** LOW
**Affected:** `src/lib/pagination.ts`

**Technical explanation:** `pageSize` is capped at 100, but `page` has no
maximum. A very large `page` value produces a very large SQL `OFFSET`,
which Postgres still has to count past - a known (not novel) deep-pagination
performance characteristic, not a correctness bug.

**Recommended remediation:** Either accept this as a non-issue given the
small expected data volumes here, or cap `page` at a sane maximum (e.g.
10,000) and return an empty page beyond it rather than a slow query.

---

### SEC-08 — CI workflow does not pin an explicit least-privilege `permissions` block

**Severity:** INFORMATIONAL
**Affected:** `.github/workflows/ci.yml`

No secrets are used or exposed in this workflow, and it doesn't publish or
deploy anything, so there's no demonstrated risk - this is a hardening
suggestion, not a finding of actual exposure. Explicitly setting
`permissions: contents: read` at the workflow level documents intent and
protects against the workflow accidentally gaining broader default
permissions if a future step is added without the author thinking about it.

---

### SEC-09 — `timezone` input has no explicit maximum length before `Intl.DateTimeFormat` validation

**Severity:** INFORMATIONAL
**Affected:** `src/modules/providers/providers.schemas.ts`

`name` and `bio` have explicit `.max()` length constraints; `timezone` does
not, relying only on Fastify's default 1 MB body size limit as the
practical ceiling. Not demonstrated as exploitable - `Intl.DateTimeFormat`
rejects invalid zone identifiers quickly - but adding an explicit `.max(100)`
(the longest real IANA zone names are well under 40 characters) would be a
cheap, obviously-correct hardening with no downside.

---

### SEC-10 — Positive finding: mass assignment is not exploitable (verified)

Not a vulnerability - recorded because it was actually tested, not assumed.
A request to `POST /providers` with injected `id`, `userId`, `createdAt`,
and `role` fields had every injected field ignored; the server generated
its own `id`/`createdAt` and correctly associated the profile with the
authenticated caller's real `userId`. This confirms Zod's default
unknown-key-stripping, combined with `fastify-type-provider-zod` replacing
`request.body` with the parsed (stripped) object before it reaches any
service function, actually closes this OWASP API Security Top 10 category
(API6:2023, Unrestricted Access to Sensitive Business Flows / mass
assignment) rather than merely appearing to on paper.

---

### SEC-11 — Positive finding: SQL injection is not exploitable (verified)

Not a vulnerability - recorded because it was actually tested. A classic
"Robert'); DROP TABLE users;--"-style payload was submitted both as a
provider `name` field and as the `search` query parameter (which is used
in an `ILIKE '%<value>%'` pattern, the one place in the codebase where a
query value is wrapped in extra characters rather than passed through
untouched). In both cases the payload was stored/matched as inert literal
text; the `users` table was confirmed intact by direct `psql` query
immediately after. Drizzle ORM's query builder parameterizes every value in
every query in this codebase - there is no raw, string-concatenated SQL
anywhere in `src/`.

## Positive Security Controls

Verified, not assumed:

- **No raw SQL anywhere** (`grep`-confirmed across `src/`); all queries go
  through Drizzle's parameterized builder.
- **Double-booking is enforced at the database level** via a Postgres
  `EXCLUDE USING gist` constraint, not only in application code - this is
  the project's central security/correctness property and the one most
  worth independent scrutiny; it has its own dedicated concurrency test
  (`test/integration/bookings-concurrency.test.ts`) and was independently
  re-verified against the real production Docker image with genuinely
  concurrent OS processes during earlier development (documented in
  `ARCHITECTURE_DECISIONS.md`).
- **Ownership is enforced in the SQL `WHERE` clause** of every mutating
  query (booking cancellation, rule/block deletion), not only checked
  beforehand in application code.
- **IDOR resistance via non-guessable identifiers**: every primary key is a
  random UUID (`uuid('id').primaryKey().defaultRandom()`), not a sequential
  integer, structurally preventing ID-enumeration attacks.
- **Passwords hashed with argon2id**, OWASP's current recommended default;
  never logged, never returned in any response (confirmed by an existing
  passing test asserting `user.passwordHash` is `undefined` in the register
  response).
- **Refresh tokens stored only as a SHA-256 hash**, rotate on every use, and
  reuse of an already-rotated token is rejected (confirmed by a passing
  test).
- **Generic, non-enumerating error messages** on login (`/auth/login`
  returns the identical message for "wrong password" and "no such account").
- **Explicit, allow-listed response shaping** on every endpoint (verified by
  reading every `toPublicX` function) - no endpoint spreads a raw database
  row into a response, so there is no path for an internal-only column
  (like `password_hash`) to leak via a future schema change being
  accidentally exposed.
- **Credential redaction in logs**: `Authorization` and `Cookie` headers are
  explicitly redacted from all request logs.
- **Secrets validated at boot, not at first use**: the app refuses to start
  if `JWT_ACCESS_SECRET` is missing or under 32 characters, surfacing a
  misconfiguration immediately rather than at the first login attempt.
- **No secret ever committed to git**, in the current tree or anywhere in
  the full commit history (checked, not assumed).
- **Non-root container user** in the production Docker image.
- **Mass assignment and SQL injection empirically tested and found
  unexploitable** (SEC-10, SEC-11 above) - not just architecturally
  plausible, actually tried.

## Unresolved Risks

As originally written, this audit found SEC-01 through SEC-09 unresolved.
See the status update at the top of this report and
[`SECURITY_REMEDIATION_LOG.md`](SECURITY_REMEDIATION_LOG.md) for what has
since changed. Risks that remain regardless of individual finding fixes:

- No automated dependency scanning runs in CI - a future finding like
  SEC-03 would again only be caught by someone manually running
  `npm audit`, not automatically.
- No backup/disaster-recovery plan exists yet for the intended production
  database (Neon) - relevant context for why SEC-01's blast radius mattered,
  and still relevant for any future destructive-operation mistake SEC-01's
  specific guard doesn't happen to cover.

## Testing Limitations

- **No live production deployment exists.** Everything was tested against
  local Docker Postgres and a local dev server. Infrastructure-level
  findings (TLS configuration, actual Render network exposure, real DNS/
  certificate setup) cannot be assessed until deployed.
- **No automated SAST/DAST tooling was run** (e.g. Semgrep, CodeQL, OWASP
  ZAP) - this audit is manual code review plus targeted manual dynamic
  testing of the specific categories above, not an exhaustive automated
  scan. A CodeQL or Semgrep pass would be a reasonable follow-up and might
  surface additional findings this review missed.
- **No load/stress testing was performed** beyond the existing 10-concurrent-
  request booking test; SEC-03's and SEC-07's severity assessments assume
  realistic, not adversarial-at-scale, traffic.
- **Supply-chain trustworthiness of dependencies** (typosquatting, maintainer
  compromise) was reviewed by manual inspection of package names only (all
  are extremely well-known: Fastify ecosystem, Drizzle, Zod, argon2,
  Vitest) - no automated SCA/provenance tool was available in this
  environment.
- **This audit was performed by an AI agent**, not a licensed, independent
  human security firm. It is a thorough first-pass review, not a
  substitute for professional penetration testing before any real user
  data is involved.

## Remediation Priority

1. **SEC-01** (seed-script guard) - cheap to fix, protects against the single
   most severe realistic failure mode in this codebase.
2. **SEC-03** (zod upgrade) - already scoped in `TASKS.md`; do before adding
   more schemas that would need the same migration later.
3. **SEC-02** (CORS wildcard validation) - cheap, same pattern as the
   existing `JWT_ACCESS_SECRET` boot-time check.
4. **SEC-09** (timezone max length) - trivial, bundle with any other schema
   touch.
5. **SEC-08** (CI permissions block) - trivial, no functional risk either way.
6. **SEC-04, SEC-06, SEC-07** - genuine but lower-urgency; reasonable to
   defer to when auth/session features are revisited.
7. **SEC-05** (password reset) - build when the feature is actually needed;
   nothing to remediate in the meantime because nothing exists yet.

## Final Assessment

Slotly has no critical findings and no confirmed, exploitable path to
unauthorized data access, privilege escalation, or injection as currently
written - and several of its central design choices (the database-enforced
booking constraint, repository-layer ownership checks, explicit response
allow-listing) are specifically the kind of defense-in-depth that prevents
entire vulnerability classes structurally rather than relying on every
individual check being written correctly. The one HIGH finding (SEC-01) is
an operational-safety gap, not an externally exploitable vulnerability, and
is straightforward to fix.

**This is not a certification of security.** No independent human review
has occurred, no automated SAST/DAST tooling was run, and there is no live
deployment to test. Before this application handles any real user data,
SEC-01 should be fixed, SEC-03 should be scheduled, and a tool-assisted
scan (Semgrep/CodeQL) is a reasonable next step beyond what manual review
alone can be expected to catch.
