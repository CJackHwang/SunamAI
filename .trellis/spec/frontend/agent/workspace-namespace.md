# Workspace Namespace

## Applicability

Read this leaf when changing WebContainer roots, file-tool path handling, shell environment, snapshots/mounts, FileManager root projection, or full-workspace ZIP download.

## Required Behavior

```ts
const WEB_CONTAINER_WORKDIR_NAME = 'workspace';
const WEB_CONTAINER_HOME = '/home/workspace';

getContainerRoot(containerId: string): string;       // c-<id>, WebContainer APIs
getContainerPublicPath(containerId: string): string; // /home/workspace/c-<id>
resolveContainerPath(containerId: string, inputPath?: string): string;
```

- WebContainer boots with `workdirName: 'workspace'`; each immutable project root is `/home/workspace/<containerId>`. Container names are labels only.
- Filesystem APIs use the relative root. Prompts, diagnostics, shell output, and environments use the canonical absolute path.
- Agent, task child, and user shells share `cwd=<containerId>`, `HOME=/home/workspace`, `SUNAM_WORKSPACE=/home/workspace/<containerId>`, and `SUNAM_CONTAINER_ID=<containerId>`.
- FileManager breadcrumb may label the active project root `/`; terminal header shows container name/short ID only. Display labels never participate in resolution or rewrite live output.
- File tools accept project-relative paths or the active canonical absolute root/path. Reject `/home/user`, relative `home/user`, old `.sunam/workspaces`, `/containers`, sibling/repeated roots, backslashes, NUL, empty/dot segments, and traversal before writes.
- Snapshot mount/export/watch, resource materialization, navigation, revision watching, and process cwd share the same relative root. Snapshot payloads remain rootless trees keyed by `containerId`; `.sunam/runtime` stays outside exports.
- Full-workspace download calls `webcontainer.export(getContainerRoot(containerId), { format: 'zip' })` without excludes. It includes hidden files, dependencies, and build output, always exports the active root, and changes neither persistence nor revision.
- At `900px` or less, FileManager file size remains visible and non-overlapping while the filename shrinks/ellipsizes.

### Validation And Error Matrix

| Condition | Required behavior |
| --- | --- |
| Active canonical absolute path | Normalize to the same relative project path; never create nested `home/workspace`. |
| Legacy/foreign/sibling/repeated/traversal path | Reject before access and name the active canonical root. |
| Managed shell starts | Use the shared environment; `.jshrc` must not appear inside the project. |
| ZIP requested while browsing a child directory | Export active container root without excludes; revision/persistence unchanged. |
| ZIP rejects or is already running | Surface error and prevent duplicate export until settled. |

## Forbidden Behavior

```ts
// Wrong
const cwd = `.sunam/workspaces/${containerId}`;
const displayPath = `/containers/${containerName}`;
const env = { HOME: `/home/workspace/${containerId}` };

// Correct
const cwd = getContainerRoot(containerId);
const project = getContainerPublicPath(containerId);
const env = { HOME: WEB_CONTAINER_HOME, SUNAM_WORKSPACE: project, SUNAM_CONTAINER_ID: containerId };
```

Do not create aliases, use project root as HOME, reuse snapshot exclusions for full ZIP, or transform real shell paths for display.

## Required Validation

- Relative/absolute normalization and all rejected path classes.
- Identical Agent/user environments and real terminal-to-Agent/FileManager round trips.
- Snapshot roots/exclusions, ZIP contents/no-revision behavior, mobile FileManager geometry, and header/breadcrumb projection.

## Related Contracts

- [Resources](./resources.md)
- [Revision, verification, and completion](./revision-verification-and-completion.md)
- [Process lifecycle](./process-lifecycle.md)
- References: `src/features/runtime`, FileManager, and `tests/runtime/webcontainer.smoke.spec.ts`.
