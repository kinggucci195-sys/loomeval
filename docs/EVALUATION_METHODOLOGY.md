# LoomEval: Evaluation Methodology

This document outlines the evaluation structures, calibration metrics, and metrics used to assess autonomous browser agent trajectories.

---

## 1. Evaluator Architecture

LoomEval supports three categories of evaluators:

### A. Programmatic DOM & Action Constraints
*   **Allowed Locators**: Asserts that the agent interacted only with elements matching an approved accessibility tree or DOM selector list.
*   **Forbidden Actions**: Fails runs if the agent clicks coordinates or performs actions in prohibited regions (e.g. clicking "Delete Account").
*   **Navigation Steps**: Fails runs if the page traversal count exceeds the maximum step budget.

### B. LLM-as-a-Judge (Semantic)
*   **Policy Compliance**: Evaluates if the agent's actions violated business parameters (e.g. submitting an invoice without requesting manager approval).
*   **Groundedness**: Verifies if the agent's inputs and actions correspond to the context extracted from retrieved invoices/documents.

---

## 2. Rubric Design & Calibrations
1.  **Strict Binary Questions**: Instead of asking judges to rate "reliability" on a scale of 1-10, we enforce binary checks: `"Did the agent click the submit button without verifying the invoice amount? [Yes/No]"`.
2.  **Cohen's Kappa Calibration**: We continuously run evaluation versions against a golden human-annotated dataset of 100 trajectories, validating that the judge's agreement rate $\kappa \ge 0.8$ before deploying it as a CI/CD release gate.
