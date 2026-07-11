/**
 * Environment validation — production-aware.
 *
 * In NODE_ENV=production:
 *   - DATABASE_URL must be PostgreSQL (not file://)
 *   - REDIS_URL is required
 *   - Artifact storage config is required
 *   - Rate limit and retention settings are required
 *
 * Fails fast: throws on startup if required variables are missing.
 */
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const postgresUrl = z.string().refine(
  (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
  { message: 'DATABASE_URL must be PostgreSQL in production (postgresql:// or postgres://)' }
);

const anyDbUrl = z.string().refine(
  (v) =>
    v.startsWith('postgresql://') ||
    v.startsWith('postgres://') ||
    v.startsWith('file:'),
  { message: 'DATABASE_URL must start with postgresql://, postgres://, or file:' }
);

const redisUrl = z.string().refine(
  (v) => v.startsWith('redis://') || v.startsWith('rediss://'),
  { message: 'REDIS_URL must start with redis:// or rediss://' }
);

// ── Base schema (shared fields) ──────────────────────────────────────────────
const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Encryption
  ENCRYPTION_KEY: z.string().optional(),
});

// ── Development / Test schema ─────────────────────────────────────────────────
const devSchema = baseSchema.extend({
  DATABASE_URL: anyDbUrl,
  REDIS_URL: redisUrl.optional(),

  // Artifact store — optional in dev (falls back to local filesystem)
  ARTIFACT_STORE_TYPE: z.enum(['local', 's3']).default('local'),
  ARTIFACT_LOCAL_PATH: z.string().default('./artifacts'),

  // S3 — only required when ARTIFACT_STORE_TYPE=s3
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  // Replay allow-list (comma-separated hostnames)
  REPLAY_ALLOWED_DOMAINS: z.string().default('localhost,127.0.0.1'),

  // Retention (days)
  TRACE_RETENTION_DAYS: z.coerce.number().default(90),
  ARTIFACT_RETENTION_DAYS: z.coerce.number().default(30),
  SCREENSHOT_RETENTION_DAYS: z.coerce.number().default(7),

  // Rate limits (requests per minute per key)
  RATE_LIMIT_TRACE_WRITE_RPM: z.coerce.number().default(60),
  RATE_LIMIT_ARTIFACT_WRITE_RPM: z.coerce.number().default(20),
  RATE_LIMIT_REPLAY_RPM: z.coerce.number().default(10),

  // Screenshot policy
  SCREENSHOT_CAPTURE: z.enum(['disabled', 'failures_only', 'all']).default('failures_only'),

  // Telemetry
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// ── Production schema — all required ─────────────────────────────────────────
const prodSchema = baseSchema.extend({
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,

  ARTIFACT_STORE_TYPE: z.enum(['local', 's3']),
  ARTIFACT_LOCAL_PATH: z.string().optional(),

  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  REPLAY_ALLOWED_DOMAINS: z.string(),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters in production'),

  TRACE_RETENTION_DAYS: z.coerce.number(),
  ARTIFACT_RETENTION_DAYS: z.coerce.number(),
  SCREENSHOT_RETENTION_DAYS: z.coerce.number(),

  RATE_LIMIT_TRACE_WRITE_RPM: z.coerce.number(),
  RATE_LIMIT_ARTIFACT_WRITE_RPM: z.coerce.number(),
  RATE_LIMIT_REPLAY_RPM: z.coerce.number(),

  SCREENSHOT_CAPTURE: z.enum(['disabled', 'failures_only', 'all']),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
}).superRefine((data, ctx) => {
  // S3 validation: if type=s3, all S3 fields must be present
  if (data.ARTIFACT_STORE_TYPE === 's3') {
    if (!data.S3_BUCKET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'S3_BUCKET required when ARTIFACT_STORE_TYPE=s3', path: ['S3_BUCKET'] });
    }
    if (!data.S3_REGION) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'S3_REGION required when ARTIFACT_STORE_TYPE=s3', path: ['S3_REGION'] });
    }
    if (!data.AWS_ACCESS_KEY_ID) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AWS_ACCESS_KEY_ID required when ARTIFACT_STORE_TYPE=s3', path: ['AWS_ACCESS_KEY_ID'] });
    }
    if (!data.AWS_SECRET_ACCESS_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AWS_SECRET_ACCESS_KEY required when ARTIFACT_STORE_TYPE=s3', path: ['AWS_SECRET_ACCESS_KEY'] });
    }
  }
});

// ── Parse and export ─────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';

const result = isProd
  ? prodSchema.safeParse(process.env)
  : devSchema.safeParse(process.env);

if (!result.success) {
  const formatted = result.error.format();
  // Log to stderr — never swallow startup failures silently
  process.stderr.write(
    `\n❌ [LoomEval] Invalid environment variables (NODE_ENV=${process.env.NODE_ENV ?? 'unset'}):\n` +
    JSON.stringify(formatted, null, 2) +
    '\n\n'
  );
  throw new Error('Environment validation failed. Check the error output above.');
}

export const env = result.data;

/** Derived helpers */
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Returns the replay allow-list as an array of hostnames. */
export function getReplayAllowedDomains(): string[] {
  const raw = (env as any).REPLAY_ALLOWED_DOMAINS ?? 'localhost,127.0.0.1';
  return raw.split(',').map((d: string) => d.trim()).filter(Boolean);
}
