# Implementation Plan

## 1. File-manager root correctness

- [x] Add stale-navigation generation/root guards to `src/features/file-manager/useFileSystem.ts`.
- [x] Harden `FileManagerToolbar` to render only validated root-relative breadcrumbs.
- [x] Add delayed-read/root-switch regressions in `tests/unit/useFileSystem.test.tsx` and breadcrumb component coverage.

## 2. Runtime-owned services

- [x] Add typed service/port contracts in the existing shared runtime contract boundary.
- [x] Implement a runtime service registry with launch records, port reconciliation, managed/orphan/stopping states and subscriptions.
- [x] Add and validate the internal Node listener preload and bounded JSONL event consumption.
- [x] Route Agent `runShell` and the interactive terminal spawn through registered runtime launch APIs.
- [x] Move WebContainer port subscriptions out of `DualTerminal` and project registry state into `ServicesPanel`.
- [x] Implement managed stop, terminal listener stop, stop timeout/reclassification, snapshot-first force restart and singleton runtime reboot.
- [x] Add localized identifying/orphan/restart confirmation/progress/error UI and accessible controls.
- [x] Cover registry parsing, exact PID provenance, lifecycle isolation, singleton remount, managed stop, orphan classification and snapshot-failure fail-closed behavior.

## 3. Localized creation defaults

- [x] Add default session/container translation keys for `zh-CN`, `en-US`, and `ja-JP`.
- [x] Add non-persisted workspace creation-default configuration and bootstrap before hydration.
- [x] Make initial/reset/new session/new container paths use current defaults.
- [x] Centralize recognition of legacy localized empty-session titles and remove Chinese comparisons from `Workspace`.
- [x] Add store/component/E2E coverage for all three locales and custom-name preservation.

## 4. Agent watchdog and visible failure

- [x] Add a shared abort-aware bounded-operation helper appropriate to Agent Core.
- [x] Bound the post-tool `reflectTask()` synchronization stage and expose synchronization phase detail.
- [x] Make failed state projection immediate and persistence/event writes best-effort bounded.
- [x] Add regressions for normal continuation, permanently hanging flush, cancellation, failure visibility, checkpoint preservation and completion/revision invariants.

## 5. Cross-layer documentation and checks

- [x] Update Agent runtime spec and architecture/design/acceptance docs.
- [x] Run focused tests while iterating:
  - `npm test -- tests/unit/useFileSystem.test.tsx tests/component/ServicesPanel.test.tsx`
  - `npm test -- tests/unit/workspaceStore.test.ts tests/component/I18nProvider.test.tsx`
  - `npm test -- tests/unit/webcontainerRuntime.test.ts tests/unit/agentEngine.test.ts`
- [x] Run `npm run typecheck`, `npm run lint`, and `npm run check:architecture`.
- [x] Run full release-significant gate: `npm run check:all`.
- [x] Review rollback points before final commit: runtime singleton/reset, preload injection, workspace bootstrap, Agent watchdog.

## Validation evidence

- `npm run check`: passed with 40 files / 204 tests; statements 90.65%, branches 82.8%, functions 89.27%, lines 95.05%.
- Focused regressions: 8 files / 51 tests passed, including terminal PID stop without killing the user shell.
- Bundle: initial 85.17 KiB gzip, total 319.85 KiB gzip, dist 1.36 MiB.
- Playwright discovery: E2E 8, visual 4, real WebContainer 3 tests loaded successfully.
- `npm audit --offline --omit=dev --audit-level=high`: 0 vulnerabilities.
- `npm run check:all`: passed; E2E 8/8, visual 4/4, real WebContainer 3/3, online production audit 0 vulnerabilities.
