# Merge Request Description

## Purpose
This MR implements the core vertical slice of **LoomEval**—an incident response and release safety test harness for web-automation agents. It introduces trace ingestion, visual browser telemetry logs, automatic policy evaluation checks, test fixture conversion, and gated experiment rollouts.

## Verification Matrix

| Verification Step | Command / Script | Result |
| :--- | :--- | :--- |
| **Git Safety Check** | `git status` | Untracked folders (`.agent`, `.claude`) ignored. |
| **DB Migration** | `npx prisma db push` | SQLite schema generated. |
| **DB Seeding** | `pnpm run db:seed` | 75 traces, 20 failures, 25 tests created. |
| **Integration Test** | `npx vitest run` | Passed (100% assertions green). |
| **Build Check** | `pnpm run build` or dev verification | Compiles. |

## File Additions
*   [prisma/schema.prisma](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/prisma/schema.prisma) — Narrow SQLite database schema modeling traces, browser actions, test cases, and releases.
*   [src/core/agent/invoiceAgent.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/agent/invoiceAgent.ts) — Playwright browser agent simulator with telemetry logging.
*   [src/core/evaluator/engine.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/evaluator/engine.ts) — Programmatic sequence and policy checker.
*   [src/core/replay/sandbox.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/replay/sandbox.ts) — Replay mock sandbox.
*   [src/core/testcase/converter.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/testcase/converter.ts) — Compiled test-case converter.
*   [src/core/__tests__/verticalSlice.test.ts](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/core/__tests__/verticalSlice.test.ts) — Comprehensive integration verification suite.
*   [src/scripts/seed.cjs](file:///c:/Users/kingg/OneDrive/Documents/Evaluation%20Harness/src/scripts/seed.cjs) — CommonJS DB seed script.
