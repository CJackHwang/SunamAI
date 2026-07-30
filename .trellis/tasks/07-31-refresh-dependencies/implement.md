# Dependency Refresh Implementation Plan

## 1. Upgrade The Root Graph

- Update all direct dependency declarations to the latest stable registry releases, including direct major releases.
- Regenerate `package-lock.json` through npm and refresh compatible transitive dependencies.
- Do not run `npm audit fix --force`, add `overrides`, or install the Vite 7-only PWA plugin downgrade.

## 2. Resolve Compatibility Changes

- Run `npm ls --depth=0`, `npm ls`, and `npm outdated --json` against the installed graph.
- If an upgraded package changes supported application/test behavior, make the smallest owned source, test, or configuration migration and add a focused regression assertion where the behavior was previously unprotected.
- Preserve the existing documentation edits already present in the worktree.

## 3. Verify And Document

- Run `npm run check:all` because dependency changes are release-significant.
- Run complete production and development audit checks; document any remaining development-only PWA/Workbox advisory accurately.
- Refresh affected README and `docs/` validation/dependency records using the final measured data.
- Review the complete diff, run `git diff --check`, and record the direct-final-outdated check.

## Risk And Rollback Points

- jsdom 30 is a direct major upgrade and may expose DOM-environment behavior changes. Isolate and validate it through the normal core test suite before treating the full gate as evidence.
- A full resolver refresh can alter bundler/native optional package entries. Treat lockfile changes as generated output; do not manually prune them unless npm resolution is invalid.
- If a compatibility failure cannot be corrected while retaining the latest package, stop and report the exact package/version and failing contract. Do not silently pin it below latest.

## Verification Evidence

- Root updates: `lucide-react` `1.28.0`, `@playwright/test` `1.62.1`, `@types/node` `26.1.2`, `@vitejs/plugin-react` `6.0.5`, jsdom `30.0.1`, Oxlint `1.76.0`, and Vite `8.2.0`. `@testing-library/dom` `10.4.1` is now explicit because `@testing-library/react` requires it as a peer.
- `npm outdated --json` returned `{}`; `npm ls --depth=0`, `npm ls`, and default `npm ci --dry-run` passed.
- `npm run check:all` passed: 49 core test files / 292 tests, E2E 13/13, visual 4/4, real WebContainer runtime 3/3, coverage 90.61/83.16/90.18/94.71 (statements/branches/functions/lines), initial/total JS 87.93/327.48 KiB gzip, dist 1.41 MiB, and production audit `found 0 vulnerabilities`.
- Full audit remains 8 high, 0 critical, limited to the documented development-only PWA/Workbox chain. `npm audit fix --force` was not used.
