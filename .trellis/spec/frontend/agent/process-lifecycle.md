# Process Lifecycle

## Applicability

Read this leaf when changing shell/process ownership, cross-Run discovery, observe/input/stop, terminal launches, port ownership, service state, or forced runtime restart.

## Required Behavior

```ts
interface AgentWorkspaceRuntime {
  runShell(request: ShellRunRequest): Promise<ShellRunResult>;
  observeProcess(processId: string, ownership: ProcessOwnership, cursor?: number): ProcessStatus | null;
  sendProcessInput(processId: string, ownership: ProcessOwnership, input: string): Promise<boolean>;
  stopProcess(processId: string, ownership: ProcessOwnership): Promise<boolean>;
  getProcesses(ownership?: Partial<ProcessOwnership>): ProcessStatus[];
  stopRun(ownership: ProcessOwnership): void;
}

type RuntimePortState = 'identifying' | 'managed' | 'orphaned' | 'stopping';
type RuntimeServiceSource = 'agent' | 'terminal';

interface RuntimePortStatus {
  port: number;
  url: string;
  state: RuntimePortState;
  source?: RuntimeServiceSource;
  containerId?: string;
  launchId?: string;
  processId?: string;
  pid?: number;
}
```

- Each registered process retains exact `(sessionId, runId, containerId)` ownership. Runtime observe/input/stop require the original tuple.
- Root `process_list` queries `{ sessionId, containerId }`, allowing later root Runs to discover earlier-Run processes in the same conversation/container. Other scopes never enter results.
- Tools resolve registered Agent process ID, then reuse its stored full ownership. Delegated roles lack cross-Run management. Run cancellation stops only exact Run ownership.
- Explicit stop kills/removes the entry, advances and flushes one exit revision, and prevents a later natural-exit callback from advancing twice. `process_stop` distinguishes pre-existing/additional drift from its expected single revision.
- Agent and user shell launches share one service registry with launch ID, source, container, command, handle, state, and time; Agent entries also keep session/run/process IDs.
- Managed launches preload `.sunam/runtime/service-hook.cjs`; validated JSONL listener events provide actual PID/port/launch ID. WebContainer port/server-ready events own visibility; UI never parses commands or infers PID from port.
- Port states are `open -> identifying -> managed|orphaned` and `managed -> stopping -> removed|orphaned`.
- Orphaned recovery is a user-confirmed global restart: flush every snapshot first, then dispose runtime/WebContainer and clear singleton layers. Snapshot failure is fail-closed.
- Provider remounts subscribe/unsubscribe from the runtime singleton; ordinary React cleanup neither rebuilds nor disposes it.

### Validation And Error Matrix

| Condition | Required behavior |
| --- | --- |
| Ownership tuple mismatch | Observe `null`; input/stop `false`; no side effect. |
| Earlier-Run process in same session/container | List with original Run and registered process IDs. |
| Other session/container | Omit; scoped not-found; no side effect. |
| Process exits between list and action | Return refreshable message naming `process_list`. |
| Explicit stop succeeds | Remove, advance/flush once, synchronize process-only task. |
| Port opens before listener record | Show `identifying`; reconcile independent of event order. |
| No valid current lifecycle | Mark `orphaned`; offer global restart, not normal stop. |
| Snapshot flush before restart fails | Keep existing runtime alive and surface failure. |
| Teardown succeeds but boot fails | Clear discarded readiness and surface boot failure. |

## Forbidden Behavior

```ts
// Wrong
await runShell(`kill $(findPidForPort(port))`);
runtime.stopProcess(processId, currentRunOwnership);

// Correct
const process = runtime.getProcesses({ sessionId, containerId })
  .find((candidate) => candidate.id === processId);
if (!process) return scopedNotFound();
await runtime.stopProcess(process.id, {
  sessionId: process.sessionId, runId: process.runId, containerId: process.containerId,
});
```

Do not guess OS PIDs, kill registered services by port, create a second terminal-owned registry, or teardown before snapshot flush.

## Required Validation

- Ownership isolation, cross-Run list/observe/input/stop, list/action race, single stop revision, listener/port ordering, PID provenance, all port transitions, snapshot-first restart, singleton remount, and real WebContainer lifecycle.
- UI/E2E covers managed stop, orphan warning/confirmation/error, and process visibility.

## Related Contracts

- [Workspace namespace](./workspace-namespace.md)
- [Revision, verification, and completion](./revision-verification-and-completion.md)
- [Checkpoint and recovery](./checkpoint-and-recovery.md)
