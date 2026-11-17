# Security Policy

What Slotly actually does for security, and what it deliberately doesn't do
yet. Written from the implementation, not aspirationally - see the file
references to verify any claim here against the real code.

## Authentication

- Passwords are hashed with **argon2id** (`src/lib/auth.ts`), never stored
  or logged in plaintext. The access-token JWT secret is validated at boot
  (`src/config/env.ts`) to be at least 32 characters; the app refuses to
  start otherwise.
- Access tokens are short-lived JWTs (`JWT_ACCESS_TTL`, default 15 minutes)
  signed with HS256. They carry only `sub` (user id) and `role` - no email,
  no PII.
- Refresh tokens are random 48-byte values; only their SHA-256 hash is
  stored (`refresh_tokens.token_hash`). They rotate on every use
  (`rotateRefreshToken`): the old one is revoked and a new one issued in the
  same response. Reusing an already-revoked token fails immediately, which
  is itself a signal of possible theft.
- `/auth/login` and `/auth/register` return the identical error for "wrong
  password" and "no such email," so a response never confirms whether a
  given email has an account.

## Authorization

- Every protected route runs `authenticate` (verifies the JWT) and, where
  relevant, `requireRole('provider' | 'customer')` as Fastify `preHandler`s
  (`src/lib/auth.ts`). There is no endpoint that infers the caller's
  identity from anything other than the verified JWT.
- Ownership of a mutated resource (an availability rule, a blocked slot, a
  booking) is enforced in the SQL `WHERE` clause of the mutation itself, not
  only checked beforehand in application code - see
  [`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md#7-ownership-enforced-in-the-repository-layers-where-clause-not-just-in-the-service).
  Acting on a resource that isn't the caller's returns `404`, the same
  response as a resource that doesn't exist, so a response never confirms
  that a given id belongs to someone else.

## Input validation

- Every request body, query string, and route param is validated by a Zod
  schema before a handler runs (`fastify-type-provider-zod`). Nothing
  reaches a service function unvalidated.
- All database access goes through Drizzle ORM's parameterized query
  builder (`src/modules/*/*.repository.ts`). There is no raw string-
  concatenated SQL anywhere in the codebase, so SQL injection isn't a
  reachable vulnerability class here.

## Transport and headers

- `@fastify/helmet` is registered for every response (secure defaults:
  `X-Content-Type-Options`, etc.).
- CORS is an explicit origin allowlist (`CORS_ORIGINS`), not a wildcard,
  and credentials are only sent to allowed origins.
- `Authorization` and `Cookie` headers are redacted from request logs
  (`src/app.ts`), so a log aggregator never captures a live credential.

## Rate limiting

- `/auth/register`, `/auth/login`, `/auth/refresh`, and `/auth/logout` are
  independently rate-limited per IP (`RATE_LIMIT_AUTH_MAX`, default 10/min).
  Every other route is unlimited by default - this is deliberately scoped to
  the routes that are actually abuse-prone (credential stuffing, account
  enumeration), not applied blindly everywhere.

## Secrets

- `.env` is gitignored; `.env.example` documents every variable's purpose
  without real values. No secret is hardcoded anywhere in `src/`.
- The production Docker image runs as the non-root `node` user.

## Known limitations

This is an honest list, not an exhaustive one. These are gaps, not
oversights discovered after the fact:

- **No email verification.** `/auth/register` creates a usable account
  immediately. Fine for a portfolio/demo API; not fine for a real product
  without it.
- **No account lockout.** Repeated failed logins are only slowed by the
  generic auth rate limit, not specifically tracked or locked per account.
- **No 2FA.**
- **Refresh tokens aren't bound to a device or IP.** A stolen refresh token
  is usable from anywhere until it's next rotated or its 30-day TTL expires.
- **No automated dependency vulnerability scanning in CI.** `npm audit`
  currently reports 13 findings. Most (minimatch, tinypool, via vitest's
  own dependency tree) are dev/test tooling, not shipped in the production
  image. One is in a production dependency and is specific enough to name
  precisely rather than wave at: `zod <4.6.6` has
  [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
  (memory exhaustion validating oversized constrained collections) - and
  zod validates every request body here, so this is a plausible, not just
  theoretical, DoS surface. Not yet fixed because the fix is a real breaking
  change, not a patch bump: it requires zod 3→4 across every schema in
  `src/`, and `fastify-type-provider-zod` 4→7 to get a zod-4-compatible
  version. Tracked in [`TASKS.md`](TASKS.md).
- **No structured security event logging** (failed-login patterns, repeated
  403s) beyond the standard request logs.
- **CSRF is not applicable** as currently built (bearer-token auth, no
  cookies, no browser-session state), but would need revisiting if a
  cookie-based web frontend is added later.

If you find a security issue in this project, it's a portfolio/demo API with
no real user data - open a GitHub issue rather than anything more formal.
