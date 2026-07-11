# LoomEval Data Handling Policy

This document details how LoomEval handles, redacts, secures, and purges telemetry data captured during browser agent execution.

---

## 1. Telemetry Capture Boundaries

LoomEval captures browser execution telemetry for evaluation and debugging:
1.  **Console Logs**: Captured from Playwright page console events.
2.  **Page Snapshots**: Page HTML DOM trees and visual screenshots (artifacts).
3.  **Network Logs**: HTTP request and response headers, methods, URLs, statuses, and payloads.

---

## 2. Redaction & Scrubbing Pipeline

All incoming telemetry undergoes recursive PII scrubbing at the ingestion endpoint:
-   **Blocked Headers**: Authentication and authorization keys (`Authorization`, `Cookie`, `Set-Cookie`, `x-api-key`) are immediately replaced with `[REDACTED]`.
-   **Body Redaction**: Payloads are recursively traversed. String matching replaces credentials, secrets, and private identifiers using normalized token sanitizers.
-   **Safe Storage**: Ingestion API keys are matched as SHA-256 hashes to guarantee plaintext tokens do not persist in server logs or database records.

---

## 3. Storage & Isolation

-   **Metadata**: Persisted in PostgreSQL. All tables are separated by project-level workspace keys.
-   **Artifact Binaries**: Saved inside tenant-specific folders under `.loomeval-artifacts/workspaceId/projectId/`. Path resolution guards block traversal queries.

---

## 4. Retention & Purging (Sweeps)

LoomEval implements programmatic retention sweeps to enforce data lifecycle policies:
-   **Database Deletes**: Cascading deletes purge expired traces, browser sessions, actions, and snapshots from PostgreSQL.
-   **Physical File Unlinking**: During database sweeps, the files associated with expired artifacts are explicitly deleted from disk to prevent storage leaks.
-   **Network Body Redaction**: Request and response payloads are cleared after policies expire, leaving metadata intact for long-term rate/cost monitoring.
