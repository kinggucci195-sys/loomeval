# Project: LoomEval Evaluation Harness

## Architecture
LoomEval is built as a Next.js TypeScript monolith using Prisma ORM. The telemetry system processes and replays browser agent trajectories.
- **Client SDK / Ingest API**: Accepts runs and writes metadata to PostgreSQL, and uploads screenshot/trace artifacts to disk.
- **Prisma & DB Layer**: Strict Postgres schemas, migrations, and tenant isolation scopes.
- **BullMQ / Redis**: Queueing architecture for Replay, Experiment, Artifact, and Retention workflows.
- **Replay / Sandbox**: Playwright browser agent replay sandbox with sandboxed execution constraints.
- **Release Gating**: Validates candidate agents against baseline runs, applying pricing, latencies, and pass rates gates.

## Code Layout
- `src/app/api/v1/traces/route.ts` - Main trace telemetry ingestion route
- `src/app/api/v1/artifacts/route.ts` - Separate multipart/streaming binary artifact upload route
- `src/app/api/health/live/route.ts` & `src/app/api/health/ready/route.ts` - Health check endpoints
- `src/core/security/keys.ts` - API Key Manager with hashing and rotation
- `src/core/security/redactor.ts` - PII Redaction utility
- `src/core/replay/sandbox.ts` - Playwright replay execution sandbox
- `src/core/experiment/runner.ts` - Runs evaluation experiments
- `src/core/release/gate.ts` - Evaluates release gates using pricing tables and percentiles
- `src/core/queue/bullmq.ts` - BullMQ queues configuration (Replay, Experiment, Artifact, Retention)
- `src/core/config/env.ts` - Zod schema verification for environment variables
- `docs/THREAT_MODEL.md`, `docs/DATA_HANDLING.md`, `SECURITY.md` - Security specifications

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | CI & Database Hardening | `.github/workflows/ci.yml` setup, environment validation (Zod), Prisma migrations enforcement | None | DONE |
| 2 | Authentication & Tenant Isolation | Hashed opaque prefixed tokens, rotation, indistinguishable errors, repository-layer tenant isolation | M1 | DONE |
| 3 | Telemetry Ingestion & Redaction | Idempotent (projectId, externalTraceId) bounds, `/api/v1/artifacts` route, PII scrubbing | M2 | DONE |
| 4 | Durable Queueing & Sandboxing | BullMQ Redis queues, safe browser action vocabulary validation, health endpoints | M3 | IN_PROGRESS |
| 5 | Release Gating & Security Documentation | Percentile tracking gates, retention sweeps, threat modeling and data handling docs | M4 | PLANNED |

## Interface Contracts
### Ingestion Key ↔ Auth Flow
- Prefix: `le_ingest_` or `le_read_` or `le_admin_`
- Key lookup uses SHA-256 hash comparison. Errors are indistinguishable to prevent timing side channels.

### Tenant Isolation
- Every query must be scoped by `workspaceId` and/or `projectId` in the service or repository layer, blocking cross-tenant access.
