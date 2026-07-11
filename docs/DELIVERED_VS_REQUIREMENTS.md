# LoomEval: Requirements vs. Implementation Compliance Matrix

This document provides a side-by-side comparison of the product requirements requested in the prompts against the delivered code, schema models, and verification states in this repository.

---

## 1. Compliance Matrix

| Requested Product Requirement | Implementation Status | Delivered Mechanism / Code Reference | Verification Method |
| :--- | :--- | :--- | :--- |
| **1. Brutal Self-Audit & Anti-Dashboard wedge** | `Completed` | [docs/PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) and [docs/PITCH.md](PITCH.md) | Formulated strategic counter-thesis and measurable kill criteria. |
| **2. Verified Research Findings (15 academic papers & competitor audits)** | `Completed` | [docs/RESEARCH.md](RESEARCH.md) and [docs/COMPETITIVE_MATRIX.md](COMPETITIVE_MATRIX.md) | Audited 15 competitors on browser-specific axes (DOM, HAR, screenshots). |
| **3. Browser Replay Feasibility Analysis** | `Completed` | [docs/BROWSER_REPLAY_FEASIBILITY.md](BROWSER_REPLAY_FEASIBILITY.md) | Structured analysis of deterministic network replay bounds (HAR vs WebSockets). |
| **4. Agent Failure Taxonomy (FAT-B1 to FAT-B6)** | `Completed` | [docs/FAILURE_TAXONOMY.md](FAILURE_TAXONOMY.md) | Classified locator breaks, VLM offsets, modal blockages, and policy violations. |
| **5. Narrow Relational Schema (SQLite quick-start)** | `Completed` | [prisma/schema.prisma](../prisma/schema.prisma) | SQLite DB migration verified via `npx prisma db push`. |
| **6. Playwright Invoices Agent (Demonstration)** | `Completed` | [src/core/agent/invoiceAgent.ts](../src/core/agent/invoiceAgent.ts) | Launches headless Chromium, navigates forms, inputs text, clicks buttons, and dumps traces. |
| **7. PII & Sensitive Header Redaction** | `Completed` | [src/core/security/redactor.ts](../src/core/security/redactor.ts) | Scrubs cookies, authorization headers, and custom text inputs. |
| **8. Ingestion Key Security (Hashing)** | `Completed` | [src/core/security/keys.ts](../src/core/security/keys.ts) | Computes and validates SHA-256 API key hashes; plaintext tokens are never stored. |
| **9. Trace Ingestion & Telemetry API** | `Completed` | [src/app/api/v1/traces/route.ts](../src/app/api/v1/traces/route.ts) | Persists browser sessions, DOM snapshots, network logs, and coordinates. |
| **10. Trajectory sequence & Policy Evaluators** | `Completed` | [src/core/evaluator/engine.ts](../src/core/evaluator/engine.ts) | Asserts navigation constraints and flags $500 auto-approval breaches (FAT-B6). |
| **11. Local Sandbox Replay (HAR Mocks)** | `Completed` | [src/core/replay/sandbox.ts](../src/core/replay/sandbox.ts) | Intercepts HTTP traffic using Playwright routing configurations. |
| **12. Failure-to-Test Case Conversion** | `Completed` | [src/core/testcase/converter.ts](../src/core/testcase/converter.ts) | Pulls logs and mock targets, compiling them into a versioned test fixture. |
| **13. Gated Release Experiments** | `Completed` | [src/core/experiment/runner.ts](../src/core/experiment/runner.ts) and [src/core/release/gate.ts](../src/core/release/gate.ts) | Executes variant configurations against suites, validating cost/latency/pass rates. |
| **14. Canary Promotions & Rollbacks** | `Seeded & Modelled` | [src/scripts/seed.cjs](../src/scripts/seed.cjs) | Models canary traffic splits, metrics checks, rollback audits, and user approvals. |
| **15. Target Portal Form Page** | `Completed` | [src/app/demo/invoice-entry/page.tsx](../src/app/demo/invoice-entry/page.tsx) | Corporate portal route with checkbox verification warnings. |

---

## 2. Core Verification Suite
All elements are verified in a single, comprehensive integration test suite:
*   **Location**: [src/core/__tests__/verticalSlice.test.ts](../src/core/__tests__/verticalSlice.test.ts)
*   **Result**: **Passed** (`npx vitest run` output verified green).

### Test Flow Verification Steps:
1.  **Ingest Failure**: Executes Agent V1 against a $650 invoice. Agent V1 fails to check the approval checkbox.
2.  **Evaluate Trace**: The evaluation engine flags the run with error code `FAT-B6` (Policy Limit Check failure).
3.  **Compile Fixture**: The failed trace is extracted and saved as a regression test case.
4.  **Steer Fix**: We test Agent V2 (Strict Prompt). Agent V2 checks the box, resulting in a successful submission.
5.  **Enforce Gate**: We run a Gated Experiment. The Release Gate blocks V1 (0% pass rate) and approves V2 (100% pass rate).
