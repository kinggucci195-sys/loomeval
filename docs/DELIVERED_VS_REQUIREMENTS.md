# LoomEval: Requirements vs. Implementation Compliance Matrix

This document provides a side-by-side comparison of the product requirements requested in the prompts against the delivered code, schema models, and verification states in this repository.

---

## 1. Compliance Matrix

| Requested Product Requirement | Implementation Status | Delivered Mechanism / Code Reference | Verification Method |
| :--- | :--- | :--- | :--- |
| **1. Brutal Self-Audit & Anti-Dashboard wedge** | **100% Compliant** | [docs/PRODUCT_STRATEGY.md](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/docs/PRODUCT_STRATEGY.md) and [docs/PITCH.md](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/docs/PITCH.md) | Formulated strategic counter-thesis and measurable kill criteria. |
| **2. Verified Research Findings (15 academic papers & competitor audits)** | **100% Compliant** | [docs/RESEARCH.md](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/docs/RESEARCH.md) and [docs/COMPETITIVE_MATRIX.md](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/docs/COMPETITIVE_MATRIX.md) | Audited 15 competitors on browser-specific axes (DOM, HAR, screenshots). |
| **3. Browser Replay Feasibility Analysis** | **100% Compliant** | [docs/BROWSER_REPLAY_FEASIBILITY.md](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/docs/BROWSER_REPLAY_FEASIBILITY.md) | Structured analysis of deterministic network replay bounds (HAR vs WebSockets). |
| **4. Agent Failure Taxonomy (FAT-B1 to FAT-B6)** | **100% Compliant** | [docs/FAILURE_TAXONOMY.md](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/docs/FAILURE_TAXONOMY.md) | Classified locator breaks, VLM offsets, modal blockages, and policy violations. |
| **5. Narrow Relational Schema (SQLite quick-start)** | **100% Compliant** | [prisma/schema.prisma](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/prisma/schema.prisma) | SQLite DB migration verified via `npx prisma db push`. |
| **6. Playwright Invoices Agent (Demonstration)** | **100% Compliant** | [src/core/agent/invoiceAgent.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/agent/invoiceAgent.ts) | Launches headless Chromium, navigates forms, inputs text, clicks buttons, and dumps traces. |
| **7. PII & Sensitive Header Redaction** | **100% Compliant** | [src/core/security/redactor.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/security/redactor.ts) | Scrubs cookies, authorization headers, and custom text inputs. |
| **8. Ingestion Key Security (Hashing)** | **100% Compliant** | [src/core/security/keys.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/security/keys.ts) | Computes and validates SHA-256 API key hashes; plaintext tokens are never stored. |
| **9. Trace Ingestion & Telemetry API** | **100% Compliant** | [invoiceAgent.ts:L142-260](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/agent/invoiceAgent.ts#L142-L260) | Persists browser sessions, DOM snapshots, network logs, and coordinates. |
| **10. Trajectory sequence & Policy Evaluators** | **100% Compliant** | [src/core/evaluator/engine.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/evaluator/engine.ts) | Asserts navigation constraints and flags $500 auto-approval breaches (FAT-B6). |
| **11. Local Sandbox Replay (HAR Mocks)** | **100% Compliant** | [src/core/replay/sandbox.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/replay/sandbox.ts) | Intercepts HTTP traffic using Playwright routing configurations. |
| **12. Failure-to-Test Case Conversion** | **100% Compliant** | [src/core/testcase/converter.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/testcase/converter.ts) | Pulls logs and mock targets, compiling them into a versioned test fixture. |
| **13. Gated Release Experiments** | **100% Compliant** | [src/core/experiment/runner.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/experiment/runner.ts) and [src/core/release/gate.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/release/gate.ts) | Executes variant configurations against suites, validating cost/latency/pass rates. |
| **14. Canary Promotions & Rollbacks** | **Seeded & Tracked** | [src/scripts/seed.cjs:357-427](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/scripts/seed.cjs#L357-L427) | Models canary traffic splits, metrics checks, rollback audits, and user approvals. |
| **15. Target Portal Form Page** | **100% Compliant** | [src/app/demo/invoice-entry/page.tsx](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/app/demo/invoice-entry/page.tsx) | Corporate portal route with checkbox verification warnings. |

---

## 2. Core Verification Suite
All elements are verified in a single, comprehensive integration test suite:
*   **Location**: [src/core/__tests__/verticalSlice.test.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/__tests__/verticalSlice.test.ts)
*   **Result**: **Passed** (`npx vitest run` output verified green).

### Test Flow Verification Steps:
1.  **Ingest Failure**: Executes Agent V1 against a $650 invoice. Agent V1 fails to check the approval checkbox.
2.  **Evaluate Trace**: The evaluation engine flags the run with error code `FAT-B6` (Policy Limit Check failure).
3.  **Compile Fixture**: The failed trace is extracted and saved as a regression test case.
4.  **Steer Fix**: We test Agent V2 (Strict Prompt). Agent V2 checks the box, resulting in a successful submission.
5.  **Enforce Gate**: We run a Gated Experiment. The Release Gate blocks V1 (0% pass rate) and approves V2 (100% pass rate).
