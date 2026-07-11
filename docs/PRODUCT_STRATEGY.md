# LoomEval: Product Strategy & Startup Thesis

## 1. Executive Summary

*   **One-Sentence positioning**: LoomEval is reproducible incident response and release safety infrastructure for production AI agents.
*   **The Wedge Product**: **Active Replay & Mock-Based Regression Testing for Browser-Based AI Agents**. 
*   **Target Customer (ICP)**: AI Engineering Leads at Series A-B startups building browser-based automation agents (automating invoice entry, insurance portal ingestion, e-commerce ordering, or back-office operational tasks).
*   **Initial Outcome Metric**: Reduce the time required to reproduce and resolve a production agent failure from **12 hours of manual investigation to under 1 hour**.

---

## 2. Customer Segment Analysis (GTM Wedge)

### Why Browser-Use Web Agents?
1.  **High Failure Frequency & Cost (Hypothesis)**: Websites update their UIs, run advertisements, change login screens, and block bots. A browser agent looping on a broken locator can consume **$10–$50 in multimodal VLM tokens in minutes** without making forward progress.
2.  **Reproduction Complexity (Fact)**: Static logs show model queries and click coordinates, but they do not capture the cookies, local storage state, dynamic DOM, or accessibility trees of the browser window at the exact moment of failure. Debugging is done in the dark.
3.  **Low Compliance Barriers (Strategic Decision)**: Web automation startups (unlike Healthtech or Fintech) do not require lengthy security reviews, HIPAA compliance audits, or multi-month penetration testing gates. They can integrate the LoomEval Playwright SDK immediately.

---

## 3. The Counter-Thesis: Why LoomEval May Fail

### A. Playwright Already Has Tracing (Architectural Risk)
*   *Objection*: Playwright features a native Trace Viewer recording DOM snapshots, network HAR, screenshots, and logs. Why would an engineer pay for LoomEval?
*   *Counter-argument*: Playwright trace viewer is a local offline zip reader. It has no concept of AI agent sessions, prompt versions, model configurations, or incident tracking. It does not group multiple failures into an actionable database or gate releases in CI/CD.

### B. Mock Drift is Hard to Automate (Technical Risk)
*   *Objection*: Mocked environments drift. If the target third-party website changes its layout, LoomEval's saved test fixtures will pass locally while failing in production.
*   *Counter-argument*: LoomEval will detect mock drift by comparing canary deployment metrics against mock-run expectations.

---

## 4. Measurable Kill Criteria
We will shut down or pivot the startup if:
1.  Fewer than 5% of active developers execute `loomeval replay` locally within 30 days of release.
2.  More than 8% of contacted pilot customers decline to install the trace-capturing SDK due to security/PII concerns.
3.  Frontier model providers integrate native, zero-cost sandboxed mock execution libraries directly into their developer consoles.
