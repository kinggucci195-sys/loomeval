# LoomEval: Browser Agent Failure Taxonomy

This document outlines the classification of production failures observed in autonomous browser agents executing web workflows.

---

## 1. Selector Failure (Broken Locators) - FAT-B1
*   **Definition**: The target element's DOM path, ID, or CSS class name changed, causing the agent's selector or accessibility lookup to fail.
*   **Symptoms**: Playwright timeout exceptions (`TimeoutError: waiting for selector ... to be visible`).
*   **Required Trace Data**: DOM Snapshot, Accessibility tree snapshot, target selector string.
*   **Reproduction**: Execute the selector against the captured DOM snapshot. If it fails, the locator is broken.
*   **Remediation**:
    *   *AI Remediator*: Request LLM to inspect the accessibility tree snapshot and generate an updated, semantic ARIA selector (e.g. `getByRole('button', { name: 'Submit' })`).
    *   *System Fix*: Update the code/agent instructions with the new locator.

---

## 2. Popup/Modal Blockage - FAT-B2
*   **Definition**: An unexpected web element (cookie consent banner, email capture dialog, pop-under advertisement) overlays the page, blocking the coordinates of the target element.
*   **Symptoms**: Action errors (`Element is not clickable at point (X, Y) because another element obscures it`).
*   **Required Trace Data**: Full page screenshot, DOM tree snapshot, target coordinates.
*   **Reproduction**: Instantiate the page snapshot locally and attempt to click the target coordinate.
*   **Remediation**:
    *   *Automatic*: Inject a standard policy step: *"If a cookie consent or overlay modal blocks the screen, dismiss it first before proceeding with the main task."*
    *   *Manual*: Update the browser's starting storage state with cookies pre-accepted.

---

## 3. VLM Click Offset (Coordinate Mismatch) - FAT-B3
*   **Definition**: Vision-Language-Action Models (VLMs) output bounding box coordinates that miss the interactable area of the button due to viewport/resolution scaling differences.
*   **Symptoms**: Successful click action from agent logs, but no page transition or network request triggers.
*   **Required Trace Data**: Viewport size, device pixel ratio, model coordinate output, screenshot highlighting target click coordinate.
*   **Reproduction**: Replay in a local sandbox using a browser with matching viewport dimensions.
*   **Remediation**:
    *   *Automatic*: Switch target selection from coordinate-based clicks to DOM-based locators.

---

## 4. Network Rate Limiting & Bot Detection - FAT-B4
*   **Definition**: The browser agent encounters a Cloudflare, Akamai, or CAPTCHA blocking screen because it triggered automated bot detection signatures.
*   **Symptoms**: HTTP 403 Forbidden responses, presence of security Challenge elements in DOM snapshot.
*   **Required Trace Data**: User-agent string, browser launch arguments, response headers, screenshot of challenge screen.
*   **Reproduction**: Execute a Live Sandbox Replay to check if the target site's firewalls consistently block the proxy IP.
*   **Remediation**:
    *   *System Fix*: Configure proxy rotation, update fingerprint headers, or integrate automated CAPTCHA-solving tools.

---

## 5. Unproductive Loop (Stuck State) - FAT-B5
*   **Definition**: The agent repeatedly clicks a button or re-enters form inputs because it fails to observe that the page did not update or threw an inline validation error.
*   **Symptoms**: High token cost, duplicate spans with identical click coordinates, lack of page navigation.
*   **Required Trace Data**: Sequence of screenshots, turn history, token usage.
*   **Reproduction**: Fixture Replay. Step through the identical state transition loop.
*   **Remediation**:
    *   *Automatic*: Trajectory loop breaker. Interrupt the agent if the exact same page snapshot and coordinate click occurs three times in a session.

---

## 6. Silent Policy Breaches - FAT-B6
*   **Definition**: The browser agent successfully completes a sequence of clicks and submissions but violates business logic constraints (e.g. submitting an invoice for $600 when the approval threshold is capped at $500).
*   **Symptoms**: Database ledger shows invalid values; no system crash occurs.
*   **Required Trace Data**: Agent state variables, model prompt version, final submission network response payload.
*   **Reproduction**: Re-run trace in Counterfactual Replay mode to check if policy is violated across multiple prompt variants.
*   **Remediation**:
    *   *System Fix*: Add hardcoded validation guards at the tool/API wrapper level (e.g., if invoice > $500, throw error before submitting network payload).
