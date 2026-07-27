# Implementation Plan

## 1. Establish the canonical path contract

- [x] Add the shared workdir name and canonical public-path helper in `src/shared/lib/containerPaths.ts`.
- [x] Replace permissive leading-slash stripping with explicit relative/current-root normalization and fail-closed rejection of legacy, foreign-container, and traversal paths.
- [x] Expand `tests/unit/containerPaths.test.ts` with a table covering relative paths, current canonical absolute paths, old roots, pseudo roots, sibling roots, duplicate roots, control separators, and `..`.

## 2. Move every runtime consumer to the real public root

- [x] Boot WebContainer with the shared `workspace` workdir name.
- [x] Update snapshot mount/export/watch, workspace file operations, FileManager root, and runtime process `cwd` to use the new relative container root.
- [x] Give Agent and user shells identical environment values: shared runtime `HOME=/home/workspace`, project-scoped `SUNAM_WORKSPACE`, and `SUNAM_CONTAINER_ID`, while preserving service-hook environment injection.
- [x] Update runtime unit fixtures and assertions for shell options, resource materialization, revision watches, snapshot export, process ownership, cancellation, and service lifecycle.

## 3. Remove the display-only path namespace

- [x] Show `/home/workspace/<containerId>` in the terminal environment bar and file-manager breadcrumb while retaining the container name as a separate label.
- [x] Stop rewriting live Agent/user terminal output to `/containers/<name>`; keep any compatibility formatting limited to inert persisted history if required by a failing recovery test.
- [x] Update component and display-path tests so every shown live path is directly executable and container rename does not change it.

## 4. Teach every Agent role the same environment

- [x] Update the shared Agent system prompt with the canonical public root and relative-path rules; remove the misleading `/<containerId>` environment description.
- [x] Update tool descriptions/errors to return the canonical root after invalid path input.
- [x] Prove root, explore child, and task child prompts use the same container namespace without changing their permissions, plans, budgets, or completion rules.

## 5. Add cross-layer and real-runtime regressions

- [x] Add runtime integration coverage proving one relative write is visible through file APIs and both shell launch types.
- [x] Extend `tests/runtime/webcontainer.smoke.spec.ts` with `pwd`, canonical absolute access, Agent write/read, user-terminal read, FileManager visibility, container rename stability, and absence of old/pseudo roots.
- [x] Cover snapshot restore after a runtime reboot and verify `.sunam/runtime` remains excluded.
- [x] Run focused checks while iterating:
  - `npm test -- tests/unit/containerPaths.test.ts tests/unit/webcontainerRuntime.test.ts tests/unit/displayPaths.test.ts`
  - `npm test -- tests/component/FileManagerToolbar.test.tsx tests/component/ServicesPanel.test.tsx tests/unit/agentTools.test.ts tests/unit/agentEngine.test.ts`
  - `npm run test:runtime`

## 6. Documentation and release gate

- [x] Update Agent runtime spec, architecture, Agent design, and acceptance documentation.
- [x] Run `npm run typecheck`, `npm run lint`, and `npm run check:architecture`.
- [x] Run the release-significant gate `npm run check:all`.
- [x] Inspect the final diff for old `.sunam/workspaces` project-root consumers and fake `/containers/<name>` live-path rendering.

## Rollback points

- Keep the path-helper/runtime/UI changes in one commit because mixed old/new roots recreate the P0.
- No database rollback is required; snapshots remain rootless trees keyed by `containerId`.
- If the real WebContainer cannot boot or spawn reliably with `workdirName: workspace`, stop before merging and retain the old runtime until a supported public-root layout is proven.
