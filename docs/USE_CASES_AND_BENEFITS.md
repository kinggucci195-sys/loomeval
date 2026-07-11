# LoomEval: Use Cases and Benefits

This document outlines the concrete engineering use cases and business benefits of the LoomEval platform, separating demonstrated MVP scenarios from roadmap applications.

---

## 1. Demonstrated MVP Use Case

### Invoice-Entry Browser Agent
A software agent reads invoices from vendor email accounts and logs into a legacy vendor entry portal to enter values.

*   **Typical Failure**: The agent enters a high-value invoice (e.g. $650) but skips checking the mandatory "Requires Approval" control, leading to database rejections.
*   **Why Ordinary Logs Fail**: Standard logs might print: `"Error: submission failed with status code 400"`. They do not show if the agent hovered over the checkbox, if the checkbox was hidden, if it was clicked out of order, or if the system prompt instructions were ignored.
*   **What LoomEval Captures**: The exact click-and-type coordinates, screenshots before/after actions, full DOM snapshots, and the token verification sequence.
*   **What is Replayed**: Re-runs the browser automation against a mock version of the vendor portal (Protocol Replay) or resets the local developer database to re-enter the invoice with a candidate prompt (Live Local Replay).
*   **Generated Test**: A test case with `initialState = { amount: 650 }` and `expectedState = { status: "SUCCESS" }` running on every subsequent build.
*   **Business Benefit**: Ensures that agent prompt iterations do not introduce policy violations, avoiding legacy billing rejections and manual accountant audits.

---

## 2. Roadmap Use Cases (Hypothetical Expansion)

### A. Insurance Claims-Processing Agent
An agent queries internal claims databases and logs into external state portal forms to submit worker compensation claims.

*   **Typical Failure**: The state portal alters its form structure (e.g. splitting "First Name" and "Last Name" into separate fields), causing the agent to mistype values or hit dead-ends.
*   **Why Ordinary Logs Fail**: Logs show `"Element not found: #fullname"`. They do not show what the new DOM layout looks like or how the agent attempted to resolve the input mapping.
*   **What LoomEval Captures**: The layout shifts, full DOM text hierarchies, and screenshot evidence at the moment of the selection failure.
*   **What is Replayed**: Protocol Replay reproduces the DOM mismatch locally using the network logs, allowing developers to test new agent search heuristics without making live claims requests.
*   **Business Benefit**: Reduces claim rejection rates and prevents double-payments caused by field mismatch inputs.

### B. Legacy Back-Office ERP Automation
Agents automate orders in a system (e.g. SAP GUI/Web portal) that lacks REST APIs.

*   **Typical Failure**: The agent gets stuck in infinite redirect loops due to server session timeouts.
*   **Why Ordinary Logs Fail**: Server logs only show multiple GET request entries. They do not capture the visual loop of the agent repeatedly clicking "Retry".
*   **What LoomEval Captures**: Action frequencies, loops, and timeline events showing navigation state cycles.
*   **What is Replayed**: Replays the session refresh sequence to test timeout retry prompt policies.
*   **Business Benefit**: Saves CPU time and prevents automated session lockout incidents in legacy enterprise systems.

### C. Automated Account Provisioning
An agent provisions customer logins and schedules initial consulting slots.

*   **Typical Failure**: The scheduling widget displays calendar collisions, causing the agent to select booked blocks.
*   **Why Ordinary Logs Fail**: Logs show `"Schedule confirmed"`. They do not reveal that the agent overwrote a prior booking.
*   **What LoomEval Captures**: Interactive widget coordinate selections and DOM snapshots of the calendar grid.
*   **What is Replayed**: Re-runs local mock calendars to check date-validation rules.
*   **Business Benefit**: Eliminates double-booking incidents and protects customer calendar scheduling integrity.
