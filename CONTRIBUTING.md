# Contributing to LoomEval

Thank you for your interest in contributing to LoomEval! We welcome community contributions to make browser agents more reliable.

---

## 1. Setup Your Development Environment

Ensure you have the following installed locally:
*   Node.js (version 18.x or 20.x)
*   Docker & Docker Compose (for running PostgreSQL locally)
*   Git

### Quick Start Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/kinggucci195-sys/loomeval.git
    cd loomeval
    ```
2.  Install package dependencies:
    ```bash
    npm install
    ```
3.  Set up your environment config file:
    ```bash
    cp .env.example .env
    ```
4.  Boot up the development database:
    ```bash
    docker compose up -d postgres
    ```
5.  Generate the Prisma Client and migrate tables:
    ```bash
    npm run db:push
    npm run db:seed
    ```
6.  Install Playwright browser binaries:
    ```bash
    npx playwright install chromium
    ```

---

## 2. Running Verification Checks

Before committing any files or submitting a Pull Request, run the following verification steps:

### A. Run Integration Test Suite
Verify that all E2E walkthroughs and trace validation tests pass successfully:
```bash
npm test
```

### B. Compile the Next.js Production Build
Verify that the bundler and compiler have zero TypeScript errors:
```bash
npx next build
```

---

## 3. Git Style Guide & Commit Rules

To maintain a clean commit history, we enforce the following guidelines:

### A. Specific Staging
*   **Do not use `git add .`**. Explicitly stage files by path to prevent local config folders (e.g. `.agent/` or `.claude/`) or debug logs from leaking into version control.
*   *Correct Example*: `git add package.json prisma/schema.prisma`

### B. Commit Messages
All commit messages must begin with a ticket namespace prefix and description:
*   *Format*: `fix(CD-XXX): description` or `feat(CD-XXX): description`
*   *Example*: `fix(CD-LOOMEVAL): implement core replay sandboxing`
