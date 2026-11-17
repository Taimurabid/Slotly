# Security Remediation Log

Tracks the lifecycle of every finding in
[`SECURITY_AUDIT_REPORT.md`](SECURITY_AUDIT_REPORT.md), from identification
through verified resolution. A finding is marked resolved only after its
fix is implemented **and** its verification procedure has actually been
run - not merely because related code was touched.

| Finding ID | Date identified | Severity               | Owner      | Fix implemented         | Verification status                      | Remaining risk                                  |
| ---------- | --------------- | ---------------------- | ---------- | ----------------------- | ---------------------------------------- | ----------------------------------------------- |
| SEC-01     | 2026-11-17      | High                   | Unassigned | Not started             | Not verified                             | Full - seed script remains unguarded            |
| SEC-02     | 2026-11-17      | Medium                 | Unassigned | Not started             | Not verified                             | Full - `CORS_ORIGINS=*` would still be accepted |
| SEC-03     | 2026-11-17      | Medium                 | Unassigned | Not started             | Not verified                             | Full - vulnerable zod version still in use      |
| SEC-04     | 2026-11-17      | Low                    | Unassigned | Not started             | Not verified                             | Full                                            |
| SEC-05     | 2026-11-17      | Low                    | Unassigned | N/A - feature not built | N/A                                      | Full (by absence)                               |
| SEC-06     | 2026-11-17      | Low                    | Unassigned | Not started             | Not verified                             | Full                                            |
| SEC-07     | 2026-11-17      | Low                    | Unassigned | Not started             | Not verified                             | Full                                            |
| SEC-08     | 2026-11-17      | Informational          | Unassigned | Not started             | Not verified                             | None (hardening only)                           |
| SEC-09     | 2026-11-17      | Informational          | Unassigned | Not started             | Not verified                             | None (hardening only)                           |
| SEC-10     | 2026-11-17      | N/A (positive finding) | N/A        | N/A                     | Verified by direct testing at audit time | None                                            |
| SEC-11     | 2026-11-17      | N/A (positive finding) | N/A        | N/A                     | Verified by direct testing at audit time | None                                            |

No findings have been remediated yet. This log will be updated as each fix
lands - see `SECURITY_AUDIT_REPORT.md`'s "Remediation Priority" section for
suggested order.

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
