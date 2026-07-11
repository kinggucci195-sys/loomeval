# LoomEval: Y Combinator Application Pitch

## 1. What is LoomEval going to make?
LoomEval builds reproducible incident response and release safety infrastructure for production AI agents. We help engineering teams detect, isolate, diagnose, and auto-remediate failures in deployed LLM browser agents by capturing deep visual browser context (screenshots, accessibility trees, and network requests) and automatically replaying them locally in sandboxed mock runs.

## 2. Where is the company going to be based?
San Francisco, California.

## 3. What is the tech stack and why?
*   **Next.js App Router & TypeScript**: Fast developer loops, unified routing, and typing security.
*   **Playwright Test & Chrome DevTools Protocol (CDP)**: The industry standard for browser automation, enabling deep DOM, network request (HAR), and accessibility tree extraction.
*   **Prisma & PostgreSQL**: Robust relational schema with strict transaction constraints to prevent cross-tenant leakages.
*   **SQLite (Local Dev fallback)**: Enables $0 quick-start integration testing out-of-the-box.

## 4. Who is your target customer?
AI Engineering leads at startups and scaleups building operational web-automation agents. These agents log into third-party vendor portals (e.g. legacy insurance grids, bank accounting ledgers, logistics dispatch grids) to automate typing, clicking, and scraping.

## 5. What is the wedge?
**Forensic Browser Replay and Network Mocking**. When an agent fails in production today, developers spend hours scanning prompt text. LoomEval lets developers execute `loomeval replay <trace_id>` to reconstruct the local DOM and run network-mocked execution walk-throughs in under a minute, isolating selector breaks (FAT-B1) and policy breaches (FAT-B6) immediately.

## 6. Why won't LangSmith, Langfuse, or Braintrust solve this?
Existing players are **text-observability platforms**. They track LLM traces, prompt metrics, and token costs. None of them connect to browser contexts. They do not record HTTP HAR logs, capture dynamic accessibility trees, or run sandboxed browser environments to verify if selectors click the correct coordinates. 

## 7. What is your competitive moat?
1.  **Mock Sandbox IP**: The technology to auto-generate fully mocked, local Playwright test fixtures from live production trace logs, enabling $0 offline regression testing.
2.  **Telemetry Integrations**: Direct hook-ins at the browser execution layer rather than the LLM endpoint layer.

## 8. What is the counter-thesis (Why will you fail)?
If web automation is replaced by robust, standardized, and secure public APIs, browser agents won't exist. However, legacy software (SAP, Oracle, local government portals) has resisted APIs for decades, ensuring browser-use remains the primary automation vector.

## 9. Pricing Hypothesis
*   **Developer Sandbox**: Free forever (local CLI replay & SQLite storage).
*   **Cloud Tier**: $0.01 per ingested trace, $50/month per active team member. Includes visual replay dashboard, failure clustering, and CI/CD release gate integrations.
