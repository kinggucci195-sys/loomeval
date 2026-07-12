# LoomEval Repository Governance & Release Discipline

This document outlines the repository governance rules and branch protection policies configured for the `loomeval` repository.

---

To guarantee release safety and maintain a green codebase, branch protection rules must be configured manually by the repository owner in the GitHub Settings UI (under `Settings > Branches > Add branch protection rule` for the default branch `feat/browser-replay-vertical-slice`):

1.  **Block Direct Pushes**: Select "Restrict who can push to matching branches" (direct pushes blocked). All changes must be submitted via feature branches.
2.  **Required Pull Requests**: Check "Require a pull request before merging" (at least 1 approval required).
3.  **Required Status Checks (CI)**: Check "Require status checks to pass before merging" and search/select the `CI` status check (Lint · Typecheck · Test · Build).
4.  **Keep Branch Up-to-Date**: Check "Require branches to be up to date before merging".
5.  **Block Force Pushes**: Check "Block force pushes" (force pushing is permanently blocked).

> [!NOTE]
> **Credential Limitation**: Automated configuration or validation of branch protection via the GitHub API is currently `BLOCKED` due to local token credential expiration (HTTP 401 Bad Credentials). Verification must be performed manually via the GitHub Web UI.

---

## 2. Feature Release Protocol

Before merging any feature branch:
1.  **Local Checks**: Run `npm run typecheck`, `npm run lint`, and `npm run test` locally to ensure zero local issues.
2.  **Pull Request Submission**: Create a detailed PR outlining what was fixed, files changed, and verification results.
3.  **Automated Status Validation**: Wait for the public GitHub Actions run to complete with a green checkmark.
4.  **Code Review**: Merge is allowed only after approvals have been granted.
