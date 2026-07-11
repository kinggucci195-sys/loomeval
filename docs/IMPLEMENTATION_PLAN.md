# LoomEval: Implementation Plan

This document outlines the phased plan executed to establish the initial working vertical slice for the **LoomEval** Agent Reliability Platform.

---

## Phase 1: Research & competitive Intelligence
*   **Track A**: Research academic papers on agent trajectories and JSDOM event simulations.
*   **Track B**: Feature-by-feature matrix comparing 15 top observability platforms.
*   **Track C**: Customer discovery analysis focusing on Series A-B browser-automation startups.
*   **Track D**: Browser-use replay feasibility study detailing HAR capture and IndexedDB limits.
*   **Track E**: Formal failure taxonomy classifications.

## Phase 2: Schema & Relational Modeling
*   Design a light relational schema on SQLite mapping users, workspaces, projects, traces, browser actions, page snapshots, test suites, experiments, and canaries.
*   Implement ingestion key hashing (SHA-256) at the controller barrier.

## Phase 3: Telemetry & Ingestion
*   Write Playwright-based browser agent harness (`src/core/agent/invoiceAgent.ts`) capturing:
    *   Dynamic DOM and accessibility trees.
    *   Page screenshots.
    *   Network request HAR payloads.
*   Configure PII redaction filters (`src/core/security/redactor.ts`) scrubbing cookies and auth headers.

## Phase 4: Gated Experiments & CI Gating
*   Build sequence and policy evaluators (`src/core/evaluator/engine.ts`).
*   Build local fixture replay sandboxes (`src/core/replay/sandbox.ts`).
*   Build trace-to-test case conversion logic (`src/core/testcase/converter.ts`).
*   Build experiment variants simulator (`src/core/experiment/runner.ts`) and release gates blocker (`src/core/release/gate.ts`).

## Phase 5: Verification & Seeding
*   Implement full database seeding (`src/scripts/seed.cjs`) with a 75-trace cohort.
*   Write E2E integration test suite (`src/core/__tests__/verticalSlice.test.ts`) executing browser telemetry hooks, failing runs, converting to tests, comparing variants, and blocking releases.
