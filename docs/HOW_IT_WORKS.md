# LoomEval: How It Works

This document walks through the step-by-step execution lifecycle of the LoomEval vertical slice, illustrating the data flow, API payloads, and source code hooks.

---

## The Walkthrough Scenario

We analyze the lifecycle of a **$650 invoice submission** through the agent pipeline.

### Step 1: Agent Initialization & Input
The [InvoiceAgent](../src/core/agent/invoiceAgent.ts) is instantiated with the target parameters:
```json
{
  "vendorName": "Acme Corp",
  "amount": 650
}
```

---

### Step 2: Interactive Decision Loop
The agent launches a headless Playwright Chromium instance, navigates to the vendor page, and loops.
1.  The agent extracts visible interactive elements:
    ```json
    [
      { "id": "vendor-name", "role": "textbox", "name": "Vendor Name" },
      { "id": "invoice-amount", "role": "textbox", "name": "Invoice Amount" },
      { "id": "approval-checkbox", "role": "checkbox", "name": "Requires Approval" },
      { "id": "submit-button", "role": "button", "name": "Submit Invoice" }
    ]
    ```
2.  The [OpenAIDecisionProvider](../src/core/agent/decision.ts) receives the elements, the action history, and the system instructions:
    *   *Baseline Instructions*: `"Submit details. DO NOT check approval."`
    *   *Decision*: The decision provider parses the instructions. Since no approval instruction is active, it decides:
        *   `FILL` vendor-name -> `Acme Corp`
        *   `FILL` invoice-amount -> `650`
        *   `SUBMIT` form (checkbox left unchecked)

---

### Step 3: Browser Execution & Portal Rejection
The agent translates logical element IDs to CSS selectors (e.g. `vendor-name` -> `#vendor-name`), types the inputs, and clicks submit.
*   The page form makes a network `POST /api/demo/invoices` call.
*   The [Portal Backend API](../src/app/api/demo/invoices/route.ts) evaluates the payload:
    ```json
    {
      "vendor": "Acme Corp",
      "amount": 650,
      "managerApproval": false
    }
    ```
*   **Rejection**: Since the amount exceeds $500 and `managerApproval` is `false`, the API rejects the request and returns `HTTP 400`:
    ```json
    {
      "status": "rejected",
      "code": "APPROVAL_REQUIRED"
    }
    ```
*   The page renders a red error banner (`bg-red-950/50`). The agent detects this banner, sets the trace final status to `FAILED`, and closes the browser.

---

### Step 4: Telemetry Ingestion
The agent compiles the execution timeline and sends it to `POST /api/v1/traces` via the [LoomEvalClient SDK](../src/core/sdk/client.ts):
```json
{
  "externalTraceId": "le_exp_run_1",
  "environmentId": "dev-env-uuid",
  "status": "FAILED",
  "actions": [
    { "actionType": "NAVIGATE", "url": "http://localhost:3000/demo/invoice-entry" },
    { "actionType": "FILL", "elementId": "vendor-name", "inputValue": "Acme Corp" },
    { "actionType": "FILL", "elementId": "invoice-amount", "inputValue": "650" },
    { "actionType": "SUBMIT" }
  ]
}
```
The [Ingestion Controller](../src/app/api/v1/traces/route.ts) validates the token, redacts authorization headers, verifies the unique `externalTraceId` boundary, and commits the records.

---

### Step 5: Failure Evaluation & Diagnosis
The [EvaluationEngine](../src/core/evaluator/engine.ts) inspects the stored actions:
*   Checks if amount exceeds $500 (`amountVal = 650`, so `amountExceeded = true`).
*   Checks if `approval-checkbox` click is present in actions (`approvalEnabled = false`).
*   **Diagnosis**: Evaluates `passed = false`. Logs a `Failure` record in the database:
    *   `failureType`: `"FAT-B6"` (Policy limit violation)
    *   `severity`: `"HIGH"`
    *   `firstBadStep`: Submission action ID
    *   `diagnosis`: `"Invoice policy breach: amount $650 submitted without approval check."`

---

### Step 6: Test Case Conversion
The developer flags the failure. The [TestCaseConverter](../src/core/testcase/converter.ts) copies the failed trace properties, saving it as a regression case:
*   `initialState`: `{ "vendorName": "Acme Corp", "amount": 650 }`
*   `expectedState`: `{ "status": "SUCCESS" }`

---

### Step 7: Replay & Candidate Experimentation
The developer drafts a corrected prompt: `"If amount > 500, you MUST check the Requires Approval box."`.
1.  The [ExperimentRunner](../src/core/experiment/runner.ts) starts a candidate run.
2.  The portal state is reset via `DELETE /api/demo/invoices`.
3.  The agent is executed again under the candidate prompt.
4.  The decision provider checks the Requires Approval box. The portal accepts the submission with `HTTP 200`.
5.  The evaluation engine analyzes the candidate trace: `passed = true`.

---

### Step 8: Release Gating
The [ReleaseGating](../src/core/release/gate.ts) runs checks on the candidate experiment run:
*   Pass rate must be 100% (`passedTests / totalTests = 1.0 >= rules.minPassRate`).
*   Latency/cost regressions must be within thresholds.
*   **Result**: Gate returns `true`, approving the candidate version for promotion.
