# LoomEval Product Requirements Document (PRD)

## 1. Product Goals & Non-Goals

### Goals
*   **Browser Trace Ingestion**: Capture normalized traces containing model calls, DOM snapshots, accessibility tree snapshots, screenshots, network requests, console logs, and storage states.
*   **Forensic Incident Package**: Package failed sessions into reproducible local test files.
*   **Four Replay Modes**:
    *   *Forensic Replay*: Inspect timelines, snapshots, and network events without re-execution.
    *   *Protocol Replay*: Re-run the browser agent against mock HTTP HAR files.
    *   *DOM Fixture Replay*: Run agent action checks against simplified local DOM snapshots.
    *   *Live Sandbox Replay*: Run agent against isolated staging environments.
*   **Gated Releases**: Compare baseline and candidate agent versions across test cases to prevent regressions.

### Non-Goals
*   A general-purpose agent framework (e.g. we do not replace Playwright or Stagehand).
*   A complete billing system or enterprise team RBAC.
*   Model training pipelines.

---

## 2. Core Functional Requirements

### 1. Browser Trace Capture & SDK
*   Playwright SDK integration that hooks into browser contexts to record DOM snapshots, accessibility snapshots, screenshots, HAR logs, and storage state.
*   Redaction rule engine to scrub cookies, sensitive headers, and user inputs before transmitting data.

### 2. Forensic Incident Package
*   A downloadable zip containing trace metadata, action timelines, screenshots, DOM/Accessibility snapshots, and network HAR files.
*   Clearly reports which steps are reproducible vs inspectable.

### 3. Replay Engine
*   *Fixture Replay*: Intercepts model and network calls, returning saved payloads.
*   *Counterfactual Replay*: Calls live model APIs but mocks all network/tool actions.
*   *Live Sandbox*: Executes agent against staging URLs.

---

## 3. Playwright Integration Spec
*   LoomEval relies on Playwright's native telemetry, extending it by linking visual browser actions to agent model calls, prompt versions, and evaluation gating.
*   Ingestion expects Playwright-compatible archives (.zip containing HAR network traffic, console logs, and action screenshots).
