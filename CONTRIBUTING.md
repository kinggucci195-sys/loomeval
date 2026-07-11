# Contributing to LoomEval

Thank you for contributing to LoomEval! This document outlines our development workflow and contribution guidelines.

---

## 1. Development Setup

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/kinggucci195-sys/loomeval.git
    cd loomeval
    ```
2.  **Install Dependencies**:
    We use `pnpm` for package management.
    ```bash
    pnpm install
    ```
3.  **Run Database Migrations**:
    Start your local PostgreSQL database, then run:
    ```bash
    pnpm run db:migrate:deploy
    ```
4.  **Install Playwright Browsers**:
    ```bash
    npx playwright install --with-deps chromium
    ```

---

## 2. Coding Standards

-   **TypeScript**: We enforce strict type checks. Ensure that `pnpm run typecheck` passes with zero errors before committing.
-   **Linting**: Run `pnpm run lint` to format and analyze the codebase.
-   **Migrations**: Do not use `prisma db push` for schema updates. All database changes must be proposed via migrations generated using `pnpm run db:migrate:dev`.

---

## 3. Contribution Workflow

1.  **Create a Feature Branch**:
    ```bash
    git checkout -b feat/your-feature-name
    ```
2.  **Make Changes & Verify Locally**:
    Run linting, type checks, and tests:
    ```bash
    pnpm run lint
    pnpm run typecheck
    pnpm run test
    ```
3.  **Submit a Pull Request**:
    Submit your PR targeting the default branch. Ensure that the public GitHub Actions CI passes successfully. Direct pushes to the default branch are blocked by branch protection policies.
