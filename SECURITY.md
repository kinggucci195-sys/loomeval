# LoomEval Security Policy

LoomEval processes browser automation logs, page screenshots, DOM trees, and network logs. This document outlines the security architecture and mechanisms implemented to protect telemetry data.

---

## 1. Data Isolation & Redaction Standards

### A. Ingestion Key Hashing
*   Ingestion keys used to auth clients at `POST /api/v1/traces` are never stored in plaintext inside the database.
*   We use a SHA-256 hash representation of the key for lookup matching. If a key leak occurs, database reads do not compromise client ingress endpoints.
*   **Verification Location**: [Key Manager](../src/core/security/keys.ts).

### B. Server-Side PII Scrubbing
*   Trace network requests are stripped of sensitive values before database persistence.
*   The system scans headers and permanently replaces target tokens (e.g. `Authorization`, `Cookie`, `Set-Cookie`, `X-Session-Token`) with `[REDACTED]` values.
*   **Verification Location**: [Redactor Utility](../src/core/security/redactor.ts).

### C. File Path Traversal Protection
*   Screenshot artifacts are saved locally to prevent cross-account path traversals (e.g. writing to `../../etc/passwd`).
*   Incoming filenames are verified to guarantee they resolve inside base directory paths. Any relative path segments (like `..`) are stripped or thrown out.
*   **Verification Location**: [LocalArtifactStore](../src/core/artifacts/store.ts).

---

## 2. Reporting Vulnerabilities

If you discover a security vulnerability within this repository, please do not open a public issue. Email details directly to the security team at `security@loomeval.org`.

We aim to acknowledge all reports within 24 hours and coordinate a public fix release within 14 days.
