# LoomEval: Browser Replay Feasibility Matrix

This document provides a technical feasibility assessment of capturing and replaying browser agent sessions deterministically, identifying supported boundaries, limitations, security concerns, and prototype recommendations.

---

## 1. Technical Capabilities Matrix

| Replay Category | Technical Vector | Feasibility | Implementation Mechanism | Limits & Edge Cases |
| :--- | :--- | :--- | :--- | :--- |
| **Network State** | **HTTP Requests / Responses** | **Possible** | Capture network traffic using Playwright HAR (HTTP Archive) router. Intercept and mock using `page.route()`. | Cannot mock encrypted/certificate-pinned connections outside browser scope; streaming responses (SSE) require mock stream delays. |
| | **WebSockets** | **Partial** | Intercept WebSocket connections at page injection layer, overriding the `WebSocket` global object. | Replaying real-time stateful server ping-pongs is non-deterministic; only basic request/response frames can be replayed. |
| | **Service Workers** | **Not Possible** | Service workers run in separate threads, intercepting network layers before Playwright hooks. | Intermittent caching by workers breaks static HAR mocks. Must bypass/deregister workers on initialization. |
| **Browser Storage** | **Cookies, Local Storage, Session Storage** | **Possible** | Playwright `browserContext.storageState()` serialization. | Expiration timestamps, host-bound session cookies that expire or require active server-side database verification. |
| | **IndexedDB** | **Partial** | Serializing database transactions and writing them back to disk. | Large databases are expensive to serialize. Requires custom helper injections to snapshot/restore. |
| **DOM & UI State** | **DOM Trees & Selectors** | **Possible** | Snapshots via `page.content()`, capturing styles, inline variables, and raw HTML nodes. | Complex Shadow DOM boundaries require explicit traversal; canvas animations cannot be captured as HTML. |
| | **Accessibility Trees** | **Possible** | Extract snapshot via Chrome DevTools Protocol (CDP) `Accessibility.getFullAXTree`. | Dynamic accessibility label shifts based on screen readers require active focus modeling. |
| | **Screenshots / Video** | **Possible** | Frame-by-frame PNG captures or Playwright video recording options. | High disk/storage overhead. |
| **Execution Logic** | **JS Timers & Events** | **Partial** | Override `setTimeout`, `setInterval`, and `Date.now()` using Sinon-like clock libraries. | Non-deterministic behaviors (e.g., `Math.random()`) will cause deviations in agent planning pathways. |

---

## 2. Supported vs. Unsupported Boundaries

### Supported Capabilities (Deterministic)
*   **Fixture-Based Static Navigation**: Replaying exact pages that rely on static text/data inputs. The network HAR mocks return the identical payloads recorded.
*   **Selector & Locator Verification**: Testing whether the agent's element selectors (CSS, XPath, Text, or ARIA labels) locate the correct element on the target page snapshot.
*   **Offline Trajectory Walkthrough**: Stepping through screenshots and accessibility states to audit the agent's decision nodes post-mortem.

### Unsupported Capabilities (Non-Deterministic)
*   **Third-Party OAuth / MFA**: We cannot replay live auth logins (e.g. Google Sign-In) that require SMS/authenticator codes or active third-party token handshakes.
*   **Server-Side State Side-Effects**: If the agent's click triggers a server action (e.g., executing a balance transfer), the mock replay cannot evaluate if the bank's database was updated—only that the network response *claimed* it was.
*   **Canvas-Based Interventions**: Capturing actions on canvas-based UI widgets (like drawing boards or map views) where HTML DOM structures do not exist.

---

## 3. Security & PII Redaction
Replaying production runs requires strict defense-in-depth safety boundaries:
1.  **Header/Cookie Scrubbing**: Deny-list sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`) from HAR recordings.
2.  **Input Text Masking**: Client-side SDK sanitizes user input fields (e.g. substituting names, passwords, credit card numbers with generic placeholders).
3.  **Screenshot Masking**: Obfuscating target visual boundaries (using bounding box coordinates from input forms) before saving trace artifacts.

---

## 4. Prototype Recommendation
For the first prototype, **LoomEval will build on Playwright's native CDP and trace archive features**. Playwright is the industry standard, and capturing storage state, network archives (HAR), and screenshot buffers directly using Playwright APIs ensures maximum compatibility and minimum maintenance overhead. We will extend Playwright tracing by linking it to model-call metadata, policy constraints, and CI/CD gating.
