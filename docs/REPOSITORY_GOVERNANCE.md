# LoomEval Repository Governance & Release Discipline

This document outlines the repository governance rules and branch protection policies configured for the `loomeval` repository.

---

## 1. Default Branch Protection Policy

To guarantee release safety and maintain a green codebase, branch protection rules are enforced on the default branch (e.g. `main` or `master`):

1.  **Block Direct Pushes**: Developers and administrators are blocked from pushing code directly to the default branch. All changes must be submitted via feature branches.
2.  **Required Pull Requests**: All changes must go through a pull request (PR). A PR cannot be merged without approvals.
3.  **Required Status Checks (CI)**: The `CI` workflow (Lint · Typecheck · Test · Build) must pass successfully before merging.
4.  **Keep Branch Up-to-Date**: Branch must be rebased or merged with the latest changes from the default branch before the merge is allowed.
5.  **Block Force Pushes**: Force pushing (`git push --force`) is permanently blocked on the default branch to prevent history modification.
6.  **Review Requirements**: At least 1 review approval is required from a project owner or senior engineer before merge authorization.

---

## 2. Feature Release Protocol

Before merging any feature branch:
1.  **Local Checks**: Run `npm run typecheck`, `npm run lint`, and `npm run test` locally to ensure zero local issues.
2.  **Pull Request Submission**: Create a detailed PR outlining what was fixed, files changed, and verification results.
3.  **Automated Status Validation**: Wait for the public GitHub Actions run to complete with a green checkmark.
4.  **Code Review**: Merge is allowed only after approvals have been granted.
