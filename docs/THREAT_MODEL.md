# LoomEval Threat Model

This document outlines the security threats identified for LoomEval and the corresponding mitigations implemented to protect the agent evaluation platform.

---

## 1. Threat Library & Risk Matrix

| Threat ID | Threat Category | Threat Description | Severity | Mitigation Controls |
|---|---|---|---|---|
| **T-1** | Spoofing & Auth | Unauthorized ingestion via leaked or guessed API Keys. | High | timingSafeEqual verification, SHA-256 key hashing in database, token prefix tracking. |
| **T-2** | Elevation of Privilege | Cross-tenant telemetry or artifact data queries. | High | Tenant project mapping validation enforced at the repository wrapper layer. |
| **T-3** | Information Disclosure | Plaintext API keys or credentials leaked in logs/databases. | Medium | Recursive JSON redactor scrubbing cookies, tokens, and authorization headers. |
| **T-4** | Tampering | Path traversal attempts targeting file/S3 storage. | High | Strict canonical path prefix matching and name normalization in `LocalArtifactStore`. |
| **T-5** | Denial of Service | API spamming and excessive browser orchestration runs. | Medium | Redis distributed rate limiting on request count, bytes, and concurrency. |
| **T-6** | Sandbox Escape | Arbitrary scripts executing in browser agent sandboxes. | High | Restricted action vocabulary constraints blocking raw script execution. |

---

## 2. Mitigation Controls

### Spoofing & Auth (T-1)
- Ingestion keys are generated with secure random bytes and prefixed (e.g., `le_trace_write_`).
- Ingestion keys are never stored in plaintext in the database.
- Key verification uses SHA-256 cryptographic hashing and `crypto.timingSafeEqual` comparison to eliminate timing attacks.

### Cross-Tenant Data Access (T-2)
- Database isolation is enforced by the prisma extensions middleware and repository wrappers.
- Every read, write, and deletion query is automatically scoped with workspace and project validations.

### Telemetry Redaction (T-3)
- Payload data is recursively scrubbed before persistence.
- Any header, query string, or payload property matching known PII/auth keys is replaced with `[REDACTED]`.

### Storage Path Traversal (T-4)
- Uploaded artifact names are cleaned and resolved absolutely.
- Verification checks confirm that the resolved path resides strictly within the tenant-isolated directory, blocking `../` traversal inputs.
