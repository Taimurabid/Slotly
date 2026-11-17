import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

/**
 * Every error response has the same shape:
 *   { "error": { "code": "NOT_FOUND", "message": "Booking not found", "details": ... } }
 *
 * `code` is a stable, machine-readable string clients can switch on.
 * `message` is for humans and may change. `details` is optional extra context
 * (for example, the list of fields that failed validation).
 */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Zod counterpart of `ErrorBody`, for routes to declare in their error response schemas. */
export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

/** An error we throw on purpose, from services, with a known status and code. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have permission to do this') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(resource: string) {
    return new AppError(404, 'NOT_FOUND', `${resource} not found`);
  }
  static conflict(code: string, message: string, details?: unknown) {
    return new AppError(409, code, message, details);
  }
  static unprocessable(code: string, message: string, details?: unknown) {
    return new AppError(422, code, message, details);
  }
}

/** Fallback codes for errors raised by Fastify or its plugins rather than by us. */
const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
};

function body(code: string, message: string, details?: unknown): ErrorBody {
  if (details === undefined) return { error: { code, message } };
  return { error: { code, message, details } };
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  // 1. Errors we raised deliberately.
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(body(error.code, error.message, error.details));
  }

  // 2. Request validation failures (Zod schemas on body/query/params/headers).
  if (error.validation) {
    const details = error.validation.map((issue) => ({
      location: error.validationContext,
      path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.'),
      message: issue.message,
    }));
    return reply.status(400).send(body('VALIDATION_ERROR', 'Request validation failed', details));
  }

  // 3. Other client errors from Fastify or plugins (bad JSON, rate limit, etc).
  const status = error.statusCode ?? 500;
  if (status >= 400 && status < 500) {
    const code = STATUS_CODES[status] ?? 'CLIENT_ERROR';
    return reply.status(status).send(body(code, error.message));
  }

  // 4. Anything else is a bug. Log the details, never leak them to the client.
  request.log.error({ err: error }, 'Unhandled error');
  return reply.status(500).send(body('INTERNAL_ERROR', 'Something went wrong'));
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  return reply
    .status(404)
    .send(body('ROUTE_NOT_FOUND', `Route ${request.method} ${request.url} not found`));
}
