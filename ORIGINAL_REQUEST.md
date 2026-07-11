# Original User Request

## Initial Request — 2026-07-11T12:02:19Z

LoomEval captures browser-agent failures, converts them into replayable regression cases, compares candidate agent behavior, and produces evidence-backed release-gate decisions.

Working directory: c:\Users\kingg\OneDrive\Documents\Evaluation Harness
Integrity mode: demo

## Requirements

### R1. CI and Database Hardening
- Create `.github/workflows/ci.yml` running Node, Playwright, Prisma, and Next.js builds on PostgreSQL and Redis service containers.
- Enforce PostgreSQL migrations via prisma/migrations and npx prisma migrate deploy instead of schema push methods.
- Validate environment variables at startup using Zod schemas.

### R2. Authentication & Tenant Isolation
- Implement hashed opaque key authentication supporting prefixed tokens (e.g. le_ingest_<token>), scoped access, key rotation, and indistinguishable lookup errors.
- Enforce structural tenant isolation filters at the repository/service layer (Workspace/Project scopes) for all trace, replay, and experiment queries.

### R3. Telemetry Ingestion & Redaction
- Implement transactional and idempotent ingestion checks on the (projectId, externalTraceId) boundary.
- Separate binary file uploads (multipart/streaming) at /api/v1/artifacts from trace metadata.
- Implement recursive and testable PII scrubbing of console logs, network payloads, cookies, and header lists.

### R4. Durable Job Queueing & Sandboxing
- Configure BullMQ and Redis queues (Replay, Experiment, Artifact, Retention) with backoffs, timeout checks, heartbeats, and dead-letter handling.
- Restrict browser automation execution to a safe action vocabulary, blocking arbitrary script or selector injections.
- Separate liveness (/api/health/live) and readiness (/api/health/ready) checks.

### R5. Release Gating & Security Documentation
- Automate release gates using immutable experiment runs, tracking percentiles, and cost table pricing histories.
- Implement soft/hard data retention sweeps.
- Compile threat mitigations inside SECURITY.md, docs/THREAT_MODEL.md, and docs/DATA_HANDLING.md.

## Acceptance Criteria

### Verification Rules
- [ ] Automated integration test suites pass for authentication, tenant isolation, redaction, sandbox constraints, and E2E vertical slice.
- [ ] Next.js production build completes with zero errors on a clean checkout.
- [ ] No plaintext keys or sensitive cookie credentials survive database logs or file writes.
- [ ] Path traversal attempts on local filesystem/S3 artifact storage are blocked and logged.
- [ ] Unauthorized cross-tenant queries, executions, or deletions return indistinguishable 404/401 results.
- [ ] Benchmark execution logs are successfully written under benchmarks/ detailing hardware, duration, error rate, p50, p95, and p99 metrics.
