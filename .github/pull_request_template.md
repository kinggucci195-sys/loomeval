# Pull Request Description

## 1. Summary
<!-- Concise summary of the changes made and the target goal. -->

## 2. Risk & Impact Analysis
- **Risk Level**: [Low | Medium | High]
- **Security Impact**: <!-- Outline any implications on PII data, API token scopes, or tenant isolation constraints. -->

## 3. Operations & Database Changes
- **Database Changes**: [None | Migrations Included]
- **Migration Names**: <!-- List migration directories added (e.g. 2026xxxxxx_name). -->
- **Rollback Plan**: <!-- Step-by-step instructions to revert changes and recover database or artifacts state. -->

## 4. Verification Evidence
- **Local Checks Output**: <!-- Paste local tsc/lint/test execution results or summary. -->
- **GitHub Actions CI Run**: <!-- Link to the green workflow run. -->

## 5. Limitations & Blockers
- **Known Limitations**: <!-- List edge cases or partial/simulated states. -->
- **Remaining Production Blockers**: <!-- List tasks required before full production readiness. -->

## 6. Pre-Merge Checklist
- [ ] Code compiles locally (`pnpm run typecheck` passes)
- [ ] Code is formatted and passes lint rules (`pnpm run lint` passes)
- [ ] Database migrations deploy successfully on clean target schema
- [ ] Sequential integration test suite runs and passes (`pnpm run test:ci` passes)
- [ ] Checked that no Windows local paths or chatbot planning artifacts are committed
