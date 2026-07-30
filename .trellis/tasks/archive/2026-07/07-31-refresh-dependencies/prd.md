# Refresh all JavaScript dependencies

## Goal

Refresh Sunam's JavaScript dependency graph to the latest stable releases so the project starts its next development cycle from a current, reproducible toolchain. Preserve the existing static-browser application behavior and validate the resulting production build, browser flows, and WebContainer runtime.

## Confirmed Facts

- The project uses Node `22.23.1` and npm `10.9.8`.
- Direct updates currently available are `@playwright/test` `1.62.0 -> 1.62.1`, `@types/node` `26.1.1 -> 26.1.2`, `@vitejs/plugin-react` `6.0.4 -> 6.0.5`, `lucide-react` `1.26.0 -> 1.28.0`, `oxlint` `1.75.0 -> 1.76.0`, `vite` `8.1.5 -> 8.2.0`, and the major test-environment update `jsdom` `29.1.1 -> 30.0.1`.
- Current Node satisfies the published engine constraints for Vite `8.2.0`, `@vitejs/plugin-react` `6.0.5`, Oxlint `1.76.0`, and jsdom `30.0.1`. `vite-plugin-pwa` `1.3.0` declares compatibility with Vite 8.
- `npm audit --omit=dev --audit-level=high` reports zero production vulnerabilities. Full audit has eight high findings only in the `vite-plugin-pwa -> workbox-build` development build chain.
- `npm audit fix --force` proposes an incompatible downgrade to `vite-plugin-pwa@1.2.0`; it must not be used.

## Requirements

- R1: Upgrade every direct dependency in `package.json` to its latest stable registry release, including major releases.
- R2: Regenerate `package-lock.json` from the upgraded root graph and refresh all compatible transitive dependencies without adding arbitrary `overrides`.
- R3: Do not downgrade `vite-plugin-pwa`, Vite, or any package solely to suppress the known development-only PWA/Workbox advisories. Wait for an upstream-compatible remediation.
- R4: Keep the application a static browser deployment with the same public behavior, persistence contracts, Agent behavior, and WebContainer integration. Adapt source or test configuration only when an upgraded dependency requires a compatible migration.
- R5: Update dependency and validation documentation to state the actual final versions, audit scope, test results, and any remaining upstream advisory.
- R6: Preserve the user's existing uncommitted documentation work and do not discard unrelated changes.

## Acceptance Criteria

- [x] AC1: `npm outdated --json` reports no direct dependency updates after the final install.
- [x] AC2: `npm ls --depth=0` and `npm ls` complete without invalid, missing, or peer-dependency errors.
- [x] AC3: `npm run check:all` passes on the upgraded dependency graph, including type checks, lint, coverage, build, bundle limits, E2E, visual, real WebContainer runtime, and production audit.
- [x] AC4: Production audit remains zero high/critical vulnerabilities. Any remaining full-audit advisory is documented as the known development-only PWA/Workbox upstream issue; no incompatible downgrade or force fix is introduced.
- [x] AC5: `package.json`, `package-lock.json`, and affected dependency/validation documentation accurately describe the final graph and verification evidence; `git diff --check` passes.

## Out Of Scope

- Replacing PWA, WebContainer, React, or the project's architecture for an unrelated dependency preference.
- Adding package overrides or pinning an unsupported package downgrade to make development audit output appear clean.
- Claiming an optimization freeze: this task requires one release-significant full gate, while the project policy requires two consecutive passes for a freeze declaration.

## Open Questions

None. The user explicitly chose full latest upgrades and accepted waiting for an upstream-compatible PWA/Workbox advisory fix.
