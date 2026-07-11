# LoomEval

> **Replay production failures. Test agent fixes. Block unsafe releases.**

[![CI Status](https://img.shields.io/badge/CI-passing-success.svg)](#verification--test-execution-results)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Testing-Playwright-emerald.svg)](https://playwright.dev/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Prisma](https://img.shields.io/badge/ORM-Prisma-indigo.svg)](https://www.prisma.io/)

LoomEval captures browser-agent execution traces, converts failed runs into reusable regression tests, replays them in isolated sandboxes, compares agent prompts and models, and blocks policy-breaking releases before deployment.

---

## 1. Quick Navigation
*   [The Problem & Solution](#2-the-problem--the-solution)
*   [Core Benefits](#3-why-loomeval-is-useful)
*   [Invoice Entry Demo Walkthrough](#4-invoice-entry-demo-walkthrough)
*   [System Architecture](#5-architecture)
*   [Quick Start Guide](#6-quick-start)
*   [API Telemetry Example](#7-telemetry-ingestion-api)
*   [Current Feature Status](#8-current-status)
*   [Known Limitations & Roadmap](#9-limitations--roadmap)
*   [Documentation Index](#10-documentation-index)

---

## 2. The Problem & The Solution

### The Problem
Browser automation agents navigate dynamic user interfaces, fill out forms, and execute backend requests. When an agent fails:
*   The page DOM or layout may shift, rendering selectors invalid.
*   User session variables and application states disappear.
*   External API mock environments drift.
*   **Result**: Simple text logs or final screenshots are insufficient. Developers are left manually guessing and reconstructing vanished webpage states to reproduce and debug failures.

### The Solution
LoomEval turns transient browser failures into executable regression tests:
```text
Capture Trace ➔ Diagnose Failure ➔ Replay Incident ➔ Generate Test Case ➔ Compare Prompt Variants ➔ Gate Release
```
1.  **Capture**: Telemetry captures action histories, DOM snapshots, network logs, and screenshots.
2.  **Diagnose**: Evaluation scripts pinpoint the exact action and time step where policy deviations occurred.
3.  **Replay**: Executes the trace offline in a Protocol sandbox (HAR network mocks) or Live Local portal environment.
4.  **Test**: Compiles the failure parameters into versioned regression cases.
5.  **Compare**: Evaluates candidate prompt variants side-by-side against the baseline failure trace.
6.  **Gate**: Hard-blocks canary deployments if candidate pass-rates or cost/latency regressions fail thresholds.

---

## 3. Why LoomEval is Useful

> **Turn a browser-agent production failure into an executable regression case instead of a one-off debugging incident.**

*   **Reproduce failures faster**: Preserve browser actions, DOM states, and network HTTP exchanges so developers don't have to rebuild webpage states manually.
*   **Turn incidents into regression coverage**: Convert production agent failures into permanent automated tests to protect future prompt versions.
*   **Prevent unsafe releases**: Evaluate candidate prompt variants against baseline incident runs and block critical policy regressions before code pushes.
*   **Process-level policy validation**: Verify the agent's action timeline step-by-step rather than checking only the final output string.

---

## 4. Invoice Entry Demo Walkthrough

LoomEval demonstrates this workflow using a browser-based vendor portal.

### The Policy Rule
*   Invoices exceeding **$500** require enabling the **Manager Approval** checkbox before submission.

### Workflow Sequence

```text
$650 Invoice Amount
      ↓
[Unsafe Agent (v1.0.0)] Submits without checking approval checkbox
      ↓
[Vendor Portal API] Rejects submission with HTTP 400 (APPROVAL_REQUIRED)
      ↓
[LoomEval SDK] Captures actions, screenshots, and logs trace telemetry
      ↓
[Evaluation Engine] Identifies policy breach (FAT-B6) at submission step
      ↓
[TestCase Converter] Converts failed trace into a permanent test case
      ↓
[Experiment Runner] Executes candidate Agent (v1.1.0) with strict prompt instructions
      ↓
[Release Gate] Candidate passes policy check; Gating approves canary simulation
```

---

## 5. Architecture

Below is the LoomEval data collection and evaluation pipeline:

![LoomEval workflow](docs/assets/loomeval-workflow.png)

A detailed technical architecture layout (detailing PostgreSQL metadata boundaries, local Traversal-Guarded storage, and sandboxed page route interceptors) is located in the [Architecture Document](docs/ARCHITECTURE.md).

---

## 6. Quick Start

### Prerequisites
*   **Node.js**: Version 18.x or 20.x
*   **Docker & Docker Compose**: (Only needed for PostgreSQL deployment; SQLite fallback is available out-of-the-box)

### Setup Instructions

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/kinggucci195-sys/loomeval.git
    cd loomeval
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Boot database container**:
    ```bash
    # Launches PostgreSQL container
    docker compose up -d postgres
    ```

4.  **Initialize Database Schema**:
    *   **PostgreSQL (Default)**:
        ```bash
        # Push schema and generate client
        npm run db:push
        npm run db:seed
        ```
    *   **SQLite Fallback (No Docker)**:
        ```bash
        # Pushes schema to dev.db and generates client
        npm run db:push:sqlite
        npm run db:seed:sqlite
        ```

5.  **Install Playwright browser runtimes**:
    ```bash
    npx playwright install chromium
    ```

6.  **Run the E2E verification test suite**:
    ```bash
    npm test
    ```

7.  **Launch Next.js Dev Server**:
    ```bash
    npm run dev
    ```
    Access the portal dashboard at `http://localhost:3000/demo/invoice-entry`.

---

## 7. Telemetry Ingestion API

To log traces from your own custom agents, make a `POST` request to the ingestion endpoint:

```bash
curl -X POST http://localhost:3000/api/v1/traces \
  -H "Authorization: Bearer le_ingest_75f3a098ce1b4a39b2cd8e41" \
  -H "Content-Type: application/json" \
  -d '{
    "externalTraceId": "ext_doc_trace_123",
    "environmentId": "environment-uuid-here",
    "agentVersion": "1.0.0",
    "promptVersion": "1.0.0",
    "userInput": "Submit invoice for Acme, amount 650",
    "sessionId": "session_doc_abc",
    "status": "FAILED",
    "actions": [
      {
        "actionType": "FILL",
        "elementId": "vendor-name",
        "selector": "#vendor-name",
        "inputValue": "Acme Corp"
      },
      {
        "actionType": "FILL",
        "elementId": "invoice-amount",
        "selector": "#invoice-amount",
        "inputValue": "650"
      },
      {
        "actionType": "SUBMIT",
        "selector": "#submit-button"
      }
    ],
    "networkLogs": [
      {
        "url": "http://localhost:3000/api/demo/invoices",
        "method": "POST",
        "requestHeaders": "{}",
        "requestBody": "{\"vendor\":\"Acme Corp\",\"amount\":650,\"managerApproval\":false}",
        "responseHeaders": "{}",
        "responseBody": "{\"status\":\"rejected\",\"code\":\"APPROVAL_REQUIRED\"}",
        "statusCode": 400,
        "latencyMs": 15
      }
    ]
  }'
```

### Response Payload
```json
{
  "status": "success",
  "traceId": "db-generated-uuid-here"
}
```

---

## 8. Current Status

LoomEval is currently a **functional MVP vertical slice**. Below is a summary of implemented components vs roadmap:

| Capability | Status | Reference Code / Config |
| :--- | :--- | :--- |
| **Relational DB Schema** | `IMPLEMENTED` | [schema.prisma](prisma/schema.prisma) / PostgreSQL |
| **Ingestion API** | `IMPLEMENTED` | [route.ts](src/app/api/v1/traces/route.ts) / JWT hashing, Zod, PII scrub |
| **Secure local storage** | `IMPLEMENTED` | [store.ts](src/core/artifacts/store.ts) / Traversal check, SHA-256 digests |
| **Deterministic policy** | `IMPLEMENTED` | [decision.ts](src/core/agent/decision.ts) |
| **OpenAI prompt mock** | `IMPLEMENTED` | [decision.ts](src/core/agent/decision.ts) |
| **E2E Browser Agent** | `IMPLEMENTED` | [invoiceAgent.ts](src/core/agent/invoiceAgent.ts) / Playwright mapping |
| **Forensic Replay** | `IMPLEMENTED` | [sandbox.ts](src/core/replay/sandbox.ts) |
| **Protocol Replay** | `PARTIAL` | [sandbox.ts](src/core/replay/sandbox.ts) / Intercepts matching HTTP/Body |
| **Live Local Replay** | `IMPLEMENTED` | [sandbox.ts](src/core/replay/sandbox.ts) / State resets & E2E re-execution |
| **Experiment Runner** | `IMPLEMENTED` | [runner.ts](src/core/experiment/runner.ts) |
| **Release Gating** | `IMPLEMENTED` | [gate.ts](src/core/release/gate.ts) / Regressions, hard blocks |
| **Canary readiness** | `SIMULATED` | [seed.cjs](src/scripts/seed.cjs) / Split metrics modeled in database |
| **Durable worker queue** | `ROADMAP` | Scheduled for next deployment stage |

For verification evidence, see [Implementation Status](docs/IMPLEMENTATION_STATUS.md).

---

## 9. Limitations & Roadmap

### Limitations
1.  **Replay Determinism**: Browser replay does not guarantee pixel-level consistency if third-party dynamic scripts render content outside local frames.
2.  **WebSocket Interception**: Real-time server push events are currently ignored in the Protocol network mocks.
3.  **PII Redaction**: Redaction is limited to request headers, authentication cookie tokens, and values entered inside form parameters. Canvas-level or screenshot pixel redaction is not implemented.
4.  **Opt-in Model Credentials**: Live OpenAI prompt tests require setting `OPENAI_API_KEY` in environment configurations. By default, tests fall back to simulated mockup completions.

### Roadmap
1.  Add support for parallel experiment executors.
2.  Integrate Redis/BullMQ worker queues for async background runs.
3.  Implement proxy routing for real canary traffic splits.
4.  Build a dashboard UI to inspect trace timeline trees and visual diffs.

---

## 10. Documentation Index

Explore the design specifications, security audits, and governance rules:
*   [Architecture Design](docs/ARCHITECTURE.md) - System architecture and directory structure.
*   [Security Policy](SECURITY.md) - Vulnerability reporting and isolation standards.
*   [Threat Model](docs/THREAT_MODEL.md) - Security threat categories and mitigations.
*   [Data Handling Policy](docs/DATA_HANDLING.md) - Telemetry collection and PII scrubbing standards.
*   [Evaluation Methodology](docs/EVALUATION_METHODOLOGY.md) - Trajectory evaluation engines and rubrics.
*   [Production Readiness Checklist](docs/PRODUCTION_READINESS_CHECKLIST.md) - Capabilitiy maturity checklist.
*   [Repository Governance Guide](docs/REPOSITORY_GOVERNANCE.md) - Branch protection rules.
*   [Contributing Workflow](CONTRIBUTING.md) - Local development and PR setup.

---

## 11. License

This repository is distributed under the [MIT License](LICENSE).
