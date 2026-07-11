# LoomEval Production Readiness Checklist

This document tracks the hardening status and blockers of core LoomEval modules using standardized release maturity categories.

---

## 1. Release Maturity Definitions
-   `IMPLEMENTED_AND_CI_VERIFIED`: Implemented in codebase and verified by a public green GitHub Actions CI run.
-   `IMPLEMENTED_LOCALLY`: Code complete, tested locally, but waiting for public CI run verification.
-   `PARTIAL`: Core logic is complete, but edge cases or auxiliary adapters are pending.
-   `SIMULATED`: Mock/stub provider used for local testing.
-   `OPT_IN`: Available but not enabled by default.
-   `NOT_IMPLEMENTED`: Not started.
-   `BLOCKED`: Dependent on external infrastructure/PR.

---

## 2. Hardening Status Audit

| Hardening Requirement | Implementation Status | Verification Method |
|---|---|---|
| **API Ingestion Auth** | `IMPLEMENTED_LOCALLY` | `auth.test.ts` (TimingSafe equal, SHA-256 hashes, scoped access) |
| **Tenant Project Isolation** | `IMPLEMENTED_LOCALLY` | `tenantIsolation.test.ts` (Isolation wrappers scoping queries) |
| **PII Telemetry Scrubbing** | `IMPLEMENTED_LOCALLY` | `redaction.test.ts` (Recursive JSON key sanitization) |
| **Durable Workers (BullMQ)** | `IMPLEMENTED_LOCALLY` | `retention.test.ts`, `verticalSlice.test.ts` (Stalled checks, attempt counts) |
| **Distributed Rate Limiter** | `IMPLEMENTED_LOCALLY` | `rateLimiting.test.ts` (Redis-backed atomic incr limits) |
| **Browser Sandbox Guards** | `IMPLEMENTED_LOCALLY` | `verticalSlice.test.ts` (Vocabulary checks, hostname constraints) |
| **Browser Timeout Lifecycle** | `IMPLEMENTED_LOCALLY` | `timeoutCancellation.test.ts` (Browser cleanups inside try-finally) |
| **Maturity / Retention Sweeps**| `IMPLEMENTED_LOCALLY` | `retention.test.ts` (Disk cleanup unlinking, cascaded DB drops) |
| **Database Migrations Flow** | `IMPLEMENTED_LOCALLY` | `prisma migrate deploy` execution |
| **Health API Routes** | `IMPLEMENTED_LOCALLY` | `/api/health/live` & `/api/health/ready` check validations |

---

## 3. Remaining Production Blockers
1.  **Public CI Verification**: Running the GitHub Actions workflow successfully to transition status from `IMPLEMENTED_LOCALLY` to `IMPLEMENTED_AND_CI_VERIFIED`.
2.  **External S3/Storage Adapter**: Adding S3 storage support for artifacts (currently using filesystem `LocalArtifactStore`).
3.  **Authentication Key Rotation APIs**: Completing admin REST routes to trigger rotations.
