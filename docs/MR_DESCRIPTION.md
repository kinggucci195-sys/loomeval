# Merge Request Description

## Purpose
This MR implements the core vertical slice of **LoomEval**—an incident response and release safety test harness for web-automation agents. It introduces trace ingestion, visual browser telemetry logs, automatic policy evaluation checks, test fixture conversion, and gated experiment rollouts.

## Verification Matrix

| Verification Step | Command / Script | Result |
| :--- | :--- | :--- |
| **Git Safety Check** | `git status` | Untracked folders (`.agent`, `.claude`) ignored. |
| **DB Migration** | `npx prisma db push` | Schema generated. |
| **DB Seeding** | `npm run db:seed` | Seeding of baseline project traces, test cases, and release environments complete. |
| **Integration Test** | `npm test` | Passed (100% assertions green). |
| **Build Check** | `npx next build` | Compiles successfully. |

## File Additions
*   [prisma/schema.prisma](../prisma/schema.prisma) — Database schema modeling traces, browser actions, test cases, and releases.
*   [src/core/agent/invoiceAgent.ts](../src/core/agent/invoiceAgent.ts) — Playwright browser agent simulator with telemetry logging.
*   [src/core/evaluator/engine.ts](../src/core/evaluator/engine.ts) — Programmatic sequence and policy checker.
*   [src/core/replay/sandbox.ts](../src/core/replay/sandbox.ts) — Replay mock sandbox.
*   [src/core/testcase/converter.ts](../src/core/testcase/converter.ts) — Compiled test-case converter.
*   [src/core/__tests__/verticalSlice.test.ts](../src/core/__tests__/verticalSlice.test.ts) — Comprehensive integration verification suite.
*   [src/scripts/seed.cjs](../src/scripts/seed.cjs) — CommonJS DB seed script.
