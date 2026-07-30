# Dependency Refresh Design

## Scope And Boundaries

The refresh owns root dependency declarations in `package.json`, the generated `package-lock.json`, and documents that record dependency/audit and validation facts. Source, test, and build configuration changes are allowed only when a latest dependency breaks a supported behavior.

The current public runtime remains a static browser application. Development-only PWA/Workbox audit findings are not production runtime dependencies and are not remediated through a forced downgrade that violates Vite 8 compatibility.

## Resolution Strategy

1. Read current registry metadata and update every direct dependency declaration to its latest stable release, including `jsdom` 30.
2. Install from the modified root manifest, then update the compatible dependency graph and lockfile through npm's normal resolver. Do not hand-edit resolved package entries or add `overrides`.
3. Inspect the installed graph with `npm ls` and `npm outdated`.
4. Run the release-significant `npm run check:all` gate. If an upgrade changes supported behavior, make the smallest compatible source/test/configuration correction and repeat the affected checks.
5. Record exact final versions, audit findings, and verification output in the dependency and validation docs.

## Compatibility Decisions

| Area | Decision | Reason |
| --- | --- | --- |
| Vite / React plugin / PWA | Upgrade together within their Vite 8-compatible releases. | Their peer ranges explicitly overlap Vite 8. |
| jsdom | Upgrade to latest in its own observable validation step. | It is the only direct major update and powers Vitest's DOM environment. |
| Transitive packages | Accept npm's latest compatible resolution. | It refreshes the lockfile without replacing peer/range contracts with unsupported overrides. |
| Eight development audit highs | Keep the current compatible PWA chain. | `npm audit fix --force` proposes `vite-plugin-pwa@1.2.0`, which does not support Vite 8. |

## Data And Public Contracts

No persistence schema, API payload, Agent tool contract, or user data migration is expected. The dependency graph may change development and build implementation details only; existing source-facing public behavior is protected by the full validation gate.

## Rollback

The change is limited to dependency manifests, generated lockfile, any compatibility fixes, and documentation. Reverting the work commit restores the previous dependency graph. No user data migration or browser-state rollback is required.
