# Technical Design

## 1. Boundaries and ownership

- `useFileSystem` owns root-bounded navigation and stale-request suppression; `FileManagerToolbar` owns user-facing breadcrumb formatting.
- A runtime-owned service registry becomes the single source of truth for WebContainer ports, launch records, process handles and stop/restart actions. `DualTerminal` only projects it.
- Workspace entities own creation defaults as injected strings; i18n owns their translated values.
- `AgentEngine` owns between-turn progress and terminal failure projection; snapshot and persistence implementations remain behind existing runtime/store interfaces.

No `sunam-v3` schema change is required.

## 2. File navigation race and path presentation

`useFileSystem` will assign a monotonically increasing navigation generation whenever `wc`, `rootDir`, or the requested directory changes. An async `readdir` result may update entries/currentPath only if its generation and root still match the latest request. ENOENT fallback is also bounded to the current root and current generation.

The toolbar will derive breadcrumbs only from a validated root-relative path. If currentPath is stale or outside root, it renders the root label alone and triggers no navigation outside the active root. Tests will delay the old root read, switch roots, then resolve the old request to prove it cannot overwrite the new view.

## 3. Runtime service registry

### 3.1 Runtime lifecycle

The WebContainer instance and `WebContainerAgentRuntime` must share one singleton lifecycle. Provider remounts subscribe/unsubscribe but do not dispose the singleton runtime. Explicit force restart performs the only teardown/recreation path:

```text
confirm -> mark restarting -> flushSnapshots -> dispose runtime
        -> WebContainer.teardown -> clear singleton state -> boot
        -> restore active container snapshot -> recreate terminal
```

If flush fails, teardown is not called.

### 3.2 Launch records

Every app-owned launch receives a generated `launchId` and a typed record:

```text
launchId, source(agent|terminal|system), containerId,
sessionId?, runId?, command, startedAt, status, processHandle
```

Agent `runShell` registers its spawned process. The interactive terminal is spawned through runtime instead of directly through `DualTerminal`, so its shell handle and output bridge also belong to the registry.

Handles are runtime-only. They are never serialized into Runs, events, checkpoints or IndexedDB.

### 3.3 Exact Node listener discovery

Before managed launches, runtime writes a small internal CommonJS preload under `.sunam/runtime/`. Managed environments include:

- `NODE_OPTIONS=--require <absolute internal preload path>`
- `SUNAM_LAUNCH_ID=<launch id>`
- `SUNAM_CONTAINER_ID=<container id>`

The preload wraps Node `net.Server.listen`, and on authoritative `listening`/`close` events appends bounded JSONL records containing action, launch ID, container ID, `process.pid`, port and timestamp to an internal runtime event file. It does not alter application source or the container snapshot.

The service registry validates and consumes these records, then joins them with WebContainer's authoritative `port` open/close event and URL. Records are bounded/truncated per runtime lifecycle. Invalid records are ignored and reported through the runtime error channel.

### 3.4 Port classification

```text
port open -> identifying (short reconciliation window)
  + valid listener record and live launch -> managed
  + no valid owner after window           -> orphaned
managed stop requested -> stopping
  + authoritative port close              -> removed
  + timeout / missing owner                -> orphaned
```

For a managed Agent launch, stop uses its retained `WebContainerProcess` handle when that handle owns the listener. For a listener inside the interactive terminal, runtime uses the listener-reported PID to send SIGTERM through a controlled Node helper; if needed it interrupts/recreates that terminal shell. The PID is accepted only when it came from a validated current-lifecycle listener record; it is never inferred from the port.

### 3.5 Orphan recovery UX

`ServicesPanel` shows normal stop controls only for managed ports. Orphan ports show a warning indicator and a distinct force-restart action. The confirmation dialog is localized and explicitly states that every global WebContainer service and terminal process will stop. While restarting, controls are disabled and progress/error state is shown.

## 4. Localized workspace defaults

Add translation keys for default session and container names in all catalogues. The workspace store gains non-persisted creation defaults and a bootstrap/configuration entry point. MainPage supplies current translated defaults before hydration; locale changes replace defaults for future creation only.

`createInitialWorkspaceState`, reset, `createSession`, and `createContainer` consume the configured defaults. Empty-session reuse uses a canonical helper that recognizes every supported historical default title. `Workspace` calls that helper instead of comparing Chinese literals.

Persisted state remains `{ title: string, name: string }`, so existing records and validation remain compatible.

## 5. Agent between-turn watchdog

Introduce an abort-aware bounded operation helper and wrap the entire `reflectTask()` synchronization stage after every tool batch. The phase detail announces checkpoint synchronization before waiting.

On timeout/error:

1. set `run.error` and `run.phase = failed` in memory;
2. call `onRunChange` immediately so RunBoard and session status update even if persistence is unhealthy;
3. stop only the failing Run's owned processes under existing ownership rules;
4. attempt bounded Run/event persistence without blocking UI termination indefinitely;
5. leave the previous successfully saved checkpoint available to `resumeTask`.

The watchdog does not convert failure into success, skip snapshot durability, weaken revision checks, or introduce an automatic retry loop.

## 6. Compatibility, risks and rollback

- Runtime preload is limited to managed processes and an internal directory outside project snapshots. If it causes incompatibility, disabling listener discovery degrades affected ports to orphan state rather than guessing ownership.
- Runtime singleton changes must preserve pagehide snapshot flush and explicit reset cleanup.
- Force restart is fail-closed on snapshot errors and always user-confirmed.
- A timed-out snapshot operation may finish later, but the Run remains failed/recoverable; no completion evidence is fabricated.
- Rollback can independently remove the listener preload/registry projection, workspace-default injection, or watchdog because no persisted schema changes are introduced.

## 7. Documentation

Update `.trellis/spec/frontend/agent-runtime-and-persistence.md`, `docs/architecture.md`, `docs/agent-v2-design.md`, and `docs/refactor-acceptance.md` with service ownership, forced restart, and bounded between-turn synchronization contracts.
