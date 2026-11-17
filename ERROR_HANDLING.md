# Error Handling

## Response shape

Every error response, from every endpoint, has the same shape
(`src/lib/errors.ts`):

```json
{
  "error": {
    "code": "SLOT_NOT_AVAILABLE",
    "message": "This slot is not available for booking",
    "details": "optional, e.g. a list of invalid fields"
  }
}
```

`code` is stable and meant to be switched on by client code. `message` is
for humans and may be reworded without notice. `details` only appears when
there's something structured to attach (validation failures).

## How an error gets this shape

A single Fastify error handler (`errorHandler` in `src/lib/errors.ts`)
converts everything into this shape, in order:

1. **`AppError`** - thrown deliberately by a service, already carries its
   HTTP status and `code`.
2. **Zod validation failures** - any request body/query/param that fails
   schema validation becomes `400 VALIDATION_ERROR`, with `details` listing
   each invalid field, its location (`body`/`querystring`/`params`), and
   the validation message.
3. **Other 4xx from Fastify or a plugin** (malformed JSON, rate limiting) -
   mapped to a stable code via a small status→code table.
4. **Anything else** - logged in full server-side, but the client only ever
   sees `500 INTERNAL_ERROR`. Internal details (stack traces, query text)
   never reach a response body.

A service never writes to `reply` directly or formats this JSON itself - it
just `throw`s an `AppError`, and the one handler does the rest. This is the
only place in the codebase a client-facing error body gets assembled.

## Every code the API can return

Pulled directly from the codebase (`grep -rn AppError.* src/`), not
reconstructed from memory - this list cannot be stale in a way that passes
review, because keeping it accurate just means re-running that grep.

| Code                         | Status | Where                                   | Meaning                                                                                                                                                                                        |
| ---------------------------- | ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`           | 400    | any route                               | Request body/query/params failed Zod validation                                                                                                                                                |
| `BAD_REQUEST`                | 400    | `POST /bookings`                        | `startsAt` is not in the future                                                                                                                                                                |
| `UNAUTHORIZED`               | 401    | `POST /auth/login`                      | Wrong password, or no account with that email (same message for both, deliberately - see `SECURITY_POLICY.md`)                                                                                 |
| `UNAUTHORIZED`               | 401    | any authenticated route                 | Missing, malformed, or expired access token                                                                                                                                                    |
| `UNAUTHORIZED`               | 401    | `POST /auth/refresh`                    | Refresh token is unknown, expired, or already revoked                                                                                                                                          |
| `FORBIDDEN`                  | 403    | any role-gated route                    | Caller's role doesn't match what the route requires                                                                                                                                            |
| `NOT_FOUND`                  | 404    | `GET/PATCH /providers/...`              | No such provider, or no profile for the caller yet                                                                                                                                             |
| `NOT_FOUND`                  | 404    | availability/blocked-slot delete routes | No such rule/block, or it isn't the caller's (same response either way)                                                                                                                        |
| `NOT_FOUND`                  | 404    | booking routes                          | No such booking, or it isn't the caller's (same response either way)                                                                                                                           |
| `ROUTE_NOT_FOUND`            | 404    | unmatched path                          | No route matches the method + path                                                                                                                                                             |
| `EMAIL_TAKEN`                | 409    | `POST /auth/register`                   | An account with that email already exists                                                                                                                                                      |
| `PROVIDER_PROFILE_EXISTS`    | 409    | `POST /providers`                       | Caller already has a provider profile                                                                                                                                                          |
| `SLOT_NOT_AVAILABLE`         | 409    | `POST /bookings`                        | Requested time isn't one of the provider's open slots - outside their availability, inside a blocked range, already booked, or lost a concurrent race for it (see `ARCHITECTURE_DECISIONS.md`) |
| `ALREADY_CANCELLED`          | 409    | `POST /bookings/:id/cancel`             | Booking's status is already `cancelled`                                                                                                                                                        |
| `CANCELLATION_WINDOW_PASSED` | 409    | `POST /bookings/:id/cancel`             | Less than 24 hours remain before the booking's start time                                                                                                                                      |
| `RATE_LIMITED`               | 429    | `/auth/*`                               | Too many requests from this IP in the current window                                                                                                                                           |
| `INTERNAL_ERROR`             | 500    | anywhere                                | Unexpected server error; details are logged, never returned                                                                                                                                    |

## Adding a new error

Add a new `static` factory on `AppError` (for a reusable HTTP-status
category) or call `AppError.conflict(code, message)` / `.unprocessable(...)`
directly for a one-off domain error, then add the row to the table above in
the same change. There's no second place that needs updating - the error
handler already knows how to serialize any `AppError`.
