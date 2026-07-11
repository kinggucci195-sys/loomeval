# LoomEval Technical Architecture

This document describes the technical layout, ingestion pipelines, replay modes, and security architecture of the LoomEval platform.

---

## 1. System Layout & Monolith Architecture

LoomEval is implemented as a unified **Next.js App Router Monolith** powered by TypeScript, Tailwind CSS, Prisma, and PostgreSQL (with an optional SQLite database fallback).

```
                      +-------------------+
                      |  Playwright SDK   |
                      +---------+---------+
                                | (API: /api/traces)
                                v
                      +-------------------+
                      |  Trace Ingestion  |
                      +---------+---------+
                                |
                                v
  +------------------+   +------+------+   +-------------------+
  | Evaluation Queue |<--| Database    |-->| Replay Sandbox    |
  | (LLM Judges)     |   | (PostgreSQL)|   | (HAR Intercept)   |
  +------------------+   +-------------+   +-------------------+
```

---

## 2. Ingestion Key Security (Architectural Decision)
*   **Plaintext Ingest Keys**: Ingestion keys are never stored in plaintext inside the database.
*   **Hashing Schema**: We store the SHA-256 hash of the ingestion key, alongside its public prefix, workspace scoping, creation timestamp, last-used timestamp, expiration date, and revocation status.
*   **Validation**: Ingest requests pass `Authorization: Bearer <key>`. The server extracts the prefix, matches records, hashes the incoming key, and verifies it against the persisted hash.

---

## 3. Replay Sandbox & HAR Routing
1.  **Protocol Replay**: The sandbox instantiates a Playwright browser context and registers network interceptions using `page.route('**/*', (route) => { ... })`. The handler inspects the incoming request, matches it against the stored `NetworkExchange` (HAR) fixtures, and returns the cached response.
2.  **Counterfactual Replay**: Same network interception layer is used to freeze API outputs, but the model calls (LLM client) are allowed to execute live queries against the specified prompt/version.
3.  **Live Sandbox Replay**: Interceptions are bypassed, and network requests route directly to staging environments. Safety boundaries block production IP endpoints by default.
