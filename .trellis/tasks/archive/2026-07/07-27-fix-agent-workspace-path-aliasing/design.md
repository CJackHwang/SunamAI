# Technical Design

## 1. Root cause and invariant

The defect is caused by two competing namespaces:

```text
physical project root:  /home/sunam/.sunam/workspaces/<containerId>
display-only root:      /containers/<mutable container name>
guessed Agent root:     /home/user or relative home/user
```

The replacement invariant is:

```text
WebContainer workdir:   /home/workspace
container relative root:<containerId>
canonical public root:  /home/workspace/<containerId>
```

The canonical public root is both the real shell path and the path shown to users and models. There is no project-path display alias. The immutable ID preserves stable multi-container ownership while the mutable name remains a label.

## 2. Path API

`src/shared/lib/containerPaths.ts` will own the complete contract:

- `WEB_CONTAINER_WORKDIR_NAME = 'workspace'`
- `WEB_CONTAINER_HOME = '/home/workspace'` is the shared runtime home and stays outside each project root.
- `getContainerRoot(containerId)` returns the WebContainer-relative root `<containerId>` for `fs`, `mount`, `export`, `watch`, and `spawn.cwd`.
- `getContainerPublicPath(containerId)` returns `/home/workspace/<containerId>` for prompts, diagnostics, environment variables, and UI.
- `resolveContainerPath(containerId, inputPath)` canonicalizes only:
  - a workspace-relative path such as `src/main.ts`;
  - the current root itself;
  - a current-root absolute path such as `/home/workspace/c-1/src/main.ts`.
- It rejects empty-invalid forms, dot segments, another container's canonical root, old `.sunam/workspaces` roots, `/containers` aliases, `/home/user`, and path-like legacy prefixes before joining.
- `relativeContainerPath` accepts only WebContainer-relative paths already under the current container root and returns model-facing relative paths.

No consumer reimplements prefix stripping or root validation.

## 3. Runtime boot and process environment

`getWebContainer()` boots with `workdirName: WEB_CONTAINER_WORKDIR_NAME`. Runtime-internal files remain under `.sunam/runtime` relative to `/home/workspace`, outside every `<containerId>` project and outside project snapshots.

`WebContainerAgentRuntime` uses `getContainerRoot(containerId)` as the exact `spawn.cwd` for Agent and interactive shells. Both launch types receive:

```text
HOME=/home/workspace
SUNAM_WORKSPACE=/home/workspace/<containerId>
SUNAM_CONTAINER_ID=<containerId>
```

`HOME` intentionally differs from the project root so `jsh` and other tools cannot create startup files such as `.jshrc` inside the user's project. Agent and user shells still receive identical values; `cwd` and `SUNAM_WORKSPACE` define the active project.

`RuntimeServiceRegistry` merges those values with its listener-hook environment instead of replacing them. Shell output is not rewritten into another path. Service metadata and Agent process output therefore report a path the process can actually access.

The runtime continues using one global WebContainer because its API supports only one live instance. Container isolation remains an application ownership boundary: file tools, snapshots, revisions, process registries, and mutation leases are container-scoped. The interactive user shell remains intentionally unrestricted.

## 4. Agent contract

`buildAgentSystemPrompt` names `/home/workspace/<containerId>` as the active workspace and states:

- relative tool paths resolve from that root;
- canonical absolute paths may be used when needed;
- `/home/user`, `/containers/<name>`, `.sunam/workspaces`, sibling IDs, and `..` are not workspace paths;
- `workspace_tree` and `read_file` remain the source of truth.

Task children inherit the same prompt builder and container ID, so no separate subagent path policy exists. Explore children remain read-only but observe the same namespace.

## 5. UI and file manager

`Workspace` passes the WebContainer-relative root to `FileManager`, while `DualTerminal` receives the canonical public path for its environment bar. The container name remains adjacent metadata.

The old `toDisplayWorkspacePath` replacement layer is removed or narrowed to non-path legacy-history rendering only. Live terminal/process output must not transform paths. `FileManagerToolbar` renders the canonical public root plus relative breadcrumbs, while its navigation callbacks continue using WebContainer-relative paths.

This separates operational values from labels without inventing a second path:

```text
label: 新容器
path:  /home/workspace/c-4038...
```

## 6. Snapshot and compatibility

Snapshots contain a rootless `FileSystemTree` keyed by `containerId`, so no IndexedDB schema migration is required. `WorkspaceSnapshotCoordinator` mounts, watches, exports, and restores the same tree at the new `<containerId>` root.

The runtime layout change takes effect on WebContainer reboot/page reload. Existing durable snapshots restore normally. Old ephemeral `.sunam/workspaces/<id>` directories are not merged automatically because merging could overwrite a newer persisted snapshot or import a previously erroneous parallel tree. Existing user data under `/home/user` is also left untouched.

Force restart remains snapshot-first and fail-closed. `.sunam/runtime` remains outside export roots and is never serialized.

## 7. Risks and rollback

- **Path compatibility:** scripts that persisted the old internal path will fail visibly. This is intentional; silently remapping old absolute paths would preserve the original ambiguity. Relative project scripts continue unchanged.
- **Workdir boot change:** the real WebContainer suite must prove pnpm setup, service hook preload, terminal launch, and preview services still work under `workdirName: workspace`.
- **Cross-container shell access:** a single WebContainer cannot provide OS-level per-container mount namespaces. Agent file tools stay fail-closed, and the model contract prohibits sibling paths; the user shell remains unrestricted by product design.
- **Rollback:** revert the workdir/root helpers and display changes together. No persisted schema or snapshot-tree transformation needs rollback.

## 8. Documentation

Update `.trellis/spec/frontend/agent-runtime-and-persistence.md`, `docs/architecture.md`, `docs/agent-v2-design.md`, and `docs/refactor-acceptance.md` to define the canonical public root and forbid display-only executable paths.
