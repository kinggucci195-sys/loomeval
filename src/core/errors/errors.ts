/**
 * LoomEval Application Error Hierarchy
 *
 * All API errors surface as typed, code-bearing JSON objects.
 * Stack traces, Prisma errors, Redis details, and raw dependency
 * messages MUST NOT appear in API responses.
 */

export type ErrorCode =
  // Auth
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHENTICATION_FAILED'
  | 'KEY_EXPIRED'
  | 'KEY_REVOKED'
  | 'INVALID_SCOPE'
  | 'INVALID_WORKSPACE'
  | 'INVALID_PROJECT'
  | 'INVALID_ENVIRONMENT'
  // Authorization
  | 'AUTHORIZATION_FAILED'
  | 'CROSS_TENANT_ACCESS_DENIED'
  // Validation
  | 'VALIDATION_ERROR'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MIME_TYPE'
  | 'CHECKSUM_MISMATCH'
  // Conflict / Idempotency
  | 'TRACE_PAYLOAD_CONFLICT'
  | 'DUPLICATE_EXTERNAL_TRACE_ID'
  | 'ARTIFACT_ALREADY_EXISTS'
  // Not Found
  | 'TRACE_NOT_FOUND'
  | 'ARTIFACT_NOT_FOUND'
  | 'REPLAY_NOT_FOUND'
  | 'EXPERIMENT_NOT_FOUND'
  | 'AGENT_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'WORKSPACE_NOT_FOUND'
  // Rate Limiting
  | 'RATE_LIMIT_EXCEEDED'
  | 'QUOTA_EXCEEDED'
  // Provider
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_SERVER_ERROR'
  | 'PROVIDER_MALFORMED_RESPONSE'
  | 'PROVIDER_RETRY_EXHAUSTED'
  // Browser / Replay
  | 'BROWSER_ERROR'
  | 'REPLAY_SECURITY_VIOLATION'
  | 'REPLAY_UNMATCHED_REQUEST'
  | 'REPLAY_TIMEOUT'
  | 'REPLAY_CANCELLED'
  | 'UNSAFE_SELECTOR'
  | 'UNSAFE_URL'
  // Artifact
  | 'ARTIFACT_UPLOAD_FAILED'
  | 'ARTIFACT_PATH_TRAVERSAL'
  | 'ARTIFACT_STORE_ERROR'
  | 'ARTIFACT_QUOTA_EXCEEDED'
  // Database / Queue / Internal
  | 'DATABASE_ERROR'
  | 'QUEUE_ERROR'
  | 'WORKER_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  /** HTTP status to return */
  status?: number;
  /** Safe additional details for structured logging (never exposed to client) */
  internalDetail?: string;
  /** Original caught error — never serialised into response */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly internalDetail?: string;

  constructor(opts: AppErrorOptions) {
    super(opts.message);
    this.name = 'AppError';
    this.code = opts.code;
    this.status = opts.status ?? httpStatusForCode(opts.code);
    this.internalDetail = opts.internalDetail;
    if (opts.cause) {
      this.cause = opts.cause;
    }
  }
}

/** Map error codes to default HTTP status codes. */
function httpStatusForCode(code: ErrorCode): number {
  if (
    code === 'AUTHENTICATION_REQUIRED' ||
    code === 'AUTHENTICATION_FAILED' ||
    code === 'KEY_EXPIRED' ||
    code === 'KEY_REVOKED' ||
    code === 'INVALID_SCOPE' ||
    code === 'INVALID_WORKSPACE' ||
    code === 'INVALID_PROJECT' ||
    code === 'INVALID_ENVIRONMENT'
  ) return 401;

  if (
    code === 'AUTHORIZATION_FAILED' ||
    code === 'CROSS_TENANT_ACCESS_DENIED'
  ) return 403;

  if (
    code === 'TRACE_NOT_FOUND' ||
    code === 'ARTIFACT_NOT_FOUND' ||
    code === 'REPLAY_NOT_FOUND' ||
    code === 'EXPERIMENT_NOT_FOUND' ||
    code === 'AGENT_NOT_FOUND' ||
    code === 'PROJECT_NOT_FOUND' ||
    code === 'WORKSPACE_NOT_FOUND'
  ) return 404;

  if (
    code === 'TRACE_PAYLOAD_CONFLICT' ||
    code === 'DUPLICATE_EXTERNAL_TRACE_ID' ||
    code === 'ARTIFACT_ALREADY_EXISTS'
  ) return 409;

  if (
    code === 'RATE_LIMIT_EXCEEDED' ||
    code === 'QUOTA_EXCEEDED' ||
    code === 'ARTIFACT_QUOTA_EXCEEDED'
  ) return 429;

  if (
    code === 'VALIDATION_ERROR' ||
    code === 'PAYLOAD_TOO_LARGE' ||
    code === 'UNSUPPORTED_MIME_TYPE' ||
    code === 'CHECKSUM_MISMATCH'
  ) return 400;

  return 500;
}

/**
 * Serialise an error into the standard API response shape.
 * Safe to return directly to clients — no internals exposed.
 */
export function toApiError(
  error: unknown,
  requestId: string
): { error: { code: string; message: string; requestId: string }; status: number } {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
      status: error.status,
    };
  }

  // Unknown errors: never leak internals
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId,
    },
    status: 500,
  };
}

/** Generate a short request ID for correlation. */
export function newRequestId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `req_${rand}`;
}
