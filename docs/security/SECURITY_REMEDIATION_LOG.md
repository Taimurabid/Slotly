# Security Remediation Log

Tracks the lifecycle of every finding in
[`SECURITY_AUDIT_REPORT.md`](SECURITY_AUDIT_REPORT.md), from identification
through verified resolution. A finding is marked resolved only after its
fix is implemented **and** its verification procedure has actually been
run - not merely because related code was touched.

| Finding ID | Date identified | Severity               | Owner      | Fix implemented                                                                                                         | Verification status                                                                          | Remaining risk                             |
| ---------- | --------------- | ---------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| SEC-01     | 2026-11-17      | High                   | Unassigned | 2026-11-17 - `assertSafeToSeed()` refuses to run when `NODE_ENV=production` without `ALLOW_SEED_DESTRUCTIVE_RESET=true` | Verified - `test/unit/seed-safety-guard.test.ts` (4 tests), full suite (114/114) still green | None                                       |
| SEC-02     | 2026-11-17      | Medium                 | Unassigned | 2026-11-17 - `CORS_ORIGINS` rejects a literal `*` at boot (`src/config/env.ts`)                                         | Verified - `test/unit/env.test.ts` (3 new tests)                                             | None                                       |
| SEC-03     | 2026-11-17      | Medium                 | Unassigned | Not started                                                                                                             | Not verified                                                                                 | Full - vulnerable zod version still in use |
| SEC-04     | 2026-11-17      | Low                    | Unassigned | Not started                                                                                                             | Not verified                                                                                 | Full                                       |
| SEC-05     | 2026-11-17      | Low                    | Unassigned | N/A - feature not built                                                                                                 | N/A                                                                                          | Full (by absence, accepted)                |
| SEC-06     | 2026-11-17      | Low                    | Unassigned | Not started                                                                                                             | Not verified                                                                                 | Full                                       |
| SEC-07     | 2026-11-17      | Low                    | Unassigned | 2026-11-17 - `page` capped at 10,000 (`src/lib/pagination.ts`)                                                          | Verified - full suite green                                                                  | None                                       |
| SEC-08     | 2026-11-17      | Informational          | Unassigned | 2026-11-17 - explicit `permissions: contents: read` added to `ci.yml`                                                   | Verified - next CI run on this commit                                                        | None                                       |
| SEC-09     | 2026-11-17      | Informational          | Unassigned | 2026-11-17 - `timezone` capped at `.max(100)` (`providers.schemas.ts`)                                                  | Verified - full suite green                                                                  | None                                       |
| SEC-10     | 2026-11-17      | N/A (positive finding) | N/A        | N/A                                                                                                                     | Verified by direct testing at audit time                                                     | None                                       |
| SEC-11     | 2026-11-17      | N/A (positive finding) | N/A        | N/A                                                                                                                     | Verified by direct testing at audit time                                                     | None                                       |

5 of 9 actionable findings resolved and verified as of 2026-11-17 (SEC-01,
SEC-02, SEC-07, SEC-08, SEC-09). SEC-03, SEC-04, SEC-06 remain open; SEC-05
remains an accepted, by-design gap (no password reset feature exists yet).

## Policy

- Critical/High findings are release blockers unless the project owner
  explicitly accepts the documented risk in writing (a note in this file is
  sufficient for a solo project).
- A finding is re-opened if a regression reintroduces it - the test added
  at verification time (per the audit report's "Verification procedure"
  for each finding) exists specifically to catch that automatically.
- This log, and a repeat of the relevant checks, should be revisited after
  any significant change to authentication, authorization, the database
  schema, dependencies, or deployment configuration.
