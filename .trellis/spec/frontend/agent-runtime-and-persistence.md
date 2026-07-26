# Agent Runtime and Persistence

This is the executable code-spec for changes that touch Agent execution, context compaction, multimodal resources, WebContainer mutations, subagents, recovery, or `sunam-v3`. Read it before editing any of those paths. The longer product rationale remains in `docs/agent-v2-design.md`; this file defines implementation contracts and review assertions.

## Responsibility split

- `AgentEngine` owns task progression, transcript groups, budgets, tool scheduling, completion gates, and the Run cancellation domain.
- `ContextComposer` owns effective token budgets, complete-round compaction, fallback summaries, and rehydration.
- `AgentModelClient` owns provider capabilities, token estimation/usage, multimodal wire mapping, and provider-specific fallback detection.
- `AgentWorkspaceRuntime` owns WebContainer files, processes, runtime service/port registration, resources, snapshots, mutation serialization, and the authoritative container revision.
- `AgentEventStore` and `V3PersistenceRepository` own durable Runs, events, checkpoints, delegated tasks, resources, terminal history, snapshots, and quarantine.
- React projects durable/runtime state. A component is never the source of execution, recovery, or verification truth.

## Scenario: change an Agent cross-layer contract

### 1. Scope / Trigger

Use this scenario when a change does any of the following:

- adds or changes an Agent tool, event, Run/checkpoint field, message content part, model capability, resource processor, subagent role, or runtime method;
- changes IndexedDB stores, indexes, record guards, deletion scope, snapshot behavior, or recovery logic;
- changes what counts as a workspace mutation, verification pass, completed Run, or resumable checkpoint;
- changes context budgeting, media reinjection, retry/fallback rules, or the data sent to an OpenAI-compatible provider.

These are cross-layer changes even when the diff starts in one file. Trace the complete path:

```text
user/model input
  -> canonical Message / tool schema
  -> AgentEngine
  -> AgentWorkspaceRuntime or AgentModelClient
  -> event/checkpoint/resource persistence
  -> recovery projector / RunBoard
```

### 2. Signatures

The public boundaries are owned by these signatures. Extend the owner; do not create a parallel local shape.

```ts
interface ModelContextProfile {
  contextWindowTokens: number;
  defaultOutputTokens: number;
  summaryReserveTokens: number;
  safetyBufferTokens: number;
}

interface AgentModelClient {
  readonly capabilities?: {
    vision: boolean | 'unknown';
    files: boolean;
    toolCalls: boolean;
  };
  getContextProfile?(): ModelContextProfile;
  estimateTokens?(value: string): number;
  complete(messages: Message[], options: {
    signal: AbortSignal;
    tools: LLMToolDefinition[];
    onDelta: (message: Pick<Message, 'content' | 'reasoning_content'>) => void;
  }): Promise<AgentModelResponse>;
}
```

```ts
interface AgentWorkspaceRuntime {
  ensureContainer(containerId: string): Promise<void>;
  getWorkspaceRevision(containerId: string): Promise<number>;
  flushWorkspace(containerId: string): Promise<void>;
  readResourceText(
    sessionId: string,
    resourceId: string,
    startLine?: number,
    endLine?: number,
    maxTokens?: number,
  ): Promise<string>;
  readResourceImage(sessionId: string, resourceId: string): Promise<RuntimeResourceDescriptor>;
  materializeResource(
    sessionId: string,
    containerId: string,
    resourceId: string,
    path: string,
  ): Promise<WorkspaceChangeSummary>;
  applyWorkspaceChanges(
    containerId: string,
    changes: Array<{ path: string; content: string; expectedContent?: string }>,
  ): Promise<WorkspaceChangeSummary[]>;
  runShell(request: ShellRunRequest): Promise<ShellRunResult>;
  observeProcess(processId: string, ownership: ProcessOwnership, cursor?: number): ProcessStatus | null;
  sendProcessInput(processId: string, ownership: ProcessOwnership, input: string): Promise<boolean>;
  stopProcess(processId: string, ownership: ProcessOwnership): Promise<boolean>;
  getProcesses(ownership?: Partial<ProcessOwnership>): ProcessStatus[];
  stopRun(ownership: ProcessOwnership): void;
}
```

```ts
interface ShellRunRequest {
  command: string;
  containerId: string;
  sessionId: string;
  runId: string;
  mode: 'foreground' | 'background';
  timeoutMs?: number;
  signal?: AbortSignal;
}
```

The concrete WebContainer runtime also owns the terminal/service projection boundary. These handles remain runtime-only and are not added to `AgentWorkspaceRuntime` merely for React convenience:

```ts
type WebContainerProcess = Awaited<ReturnType<WebContainer['spawn']>>;
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

interface WebContainerAgentRuntime {
  spawnUserShell(containerId: string): Promise<{ launchId: string; process: WebContainerProcess }>;
  stopUserShell(launchId: string): boolean;
  getPorts(): RuntimePortStatus[];
  subscribePorts(listener: () => void): () => void;
  stopPort(port: number): Promise<boolean>;
  flushSnapshots(): Promise<void>;
}
```

```ts
type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_resource'; resourceId: string }
  | { type: 'file_resource'; resourceId: string };

interface AgentCheckpoint {
  id: string;                 // always normalized to runId
  runId: string;
  sessionId: string;
  containerId: string;
  summary: string;
  messages: Message[];        // recent complete API rounds only
  createdAt: number;
  eventTailSequence?: number;
  workspaceRevision?: number;
  resourceIds?: string[];
}
```

```ts
interface SubagentNotification {
  runId: string;
  taskId: string;             // model-visible business label
  role: 'explore' | 'implement' | 'verify';
  status: AgentTaskStatus;
  summary: string;
  evidence: string[];
  changedPaths: string[];
  verificationRecords: VerificationEvidence[];
  workspaceRevision: number;
  usage: AgentUsage;
  blockedReason?: string;
}
```

`V3PersistenceRepository` is the only production IndexedDB facade. Required operations include stable session/run event pages, one checkpoint per Run, session-scoped resource lookup, delegated-task lookup, revision-bearing snapshots, quarantine reads, and transactional session/container deletion.

### 3. Contracts

#### Context and model requests

- Effective input budget is `contextWindow - defaultOutput - summaryReserve - safetyBuffer`, then includes system prompt, tool schemas, transcript, and media estimates.
- OpenAI-compatible wire adapters accept `string | null | undefined` for optional `content` / `reasoning_content` fields. Normalize `null` to an absent delta before accumulation; do not reject an otherwise valid reasoning frame because `content` is null, and do not accept other field types.
- Streaming reasoning accumulated by the model adapter must survive both tool-call rounds and final plain assistant messages. UI projection is not responsible for reconstructing lost reasoning.
- Assistant tool calls and all matching tool results are one indivisible group. Any trim/retry removes complete groups.
- Automatic compaction triggers before the effective window is exhausted. It has no user setting, button, or confirmation path.
- Semantic compaction uses `tools: []`. Images, Blob/File bodies, data URLs, long Base64, and materializable document bodies are replaced by durable ID markers.
- PTL recovery is bounded: at most three requests, removing the oldest 20% complete groups per attempt. After that, use deterministic summary + circuit reason. Never add a fourth retry owner.
- A single oversized recent round must be estimator-clipped so `afterTokens <= effectiveTokens`; do not keep an oversized group merely because it is the newest group.
- Rehydration includes Task Contract, current plan, evidence, authoritative workspace revision, event tail, active resource IDs, active/unfinished subagent state, and at most five bounded recent file slices.
- `canonicalContentParts`, `messageText`, and `canonicalizeMessage` own internal message normalization. Provider adapters may create temporary `image_url` data URLs only while building the outbound request.

#### Resources

- Resource Blob/modelBlob data lives only in the `resources` store. Message/event/checkpoint records contain resource IDs and safe UI metadata only.
- Limits are enforced in both UI intake and `ResourceProcessorRegistry`: 8 resources/message, text 2 MiB, image 10 MiB, binary 20 MiB, total batch 50 MiB.
- SHA-256 deduplication is session-scoped. Every resource read/materialize call receives `sessionId` and rejects cross-session IDs.
- Images must pass signature sniffing and browser decode/dimension validation. The model copy is at most 2048 px on the longest edge and 1.5 MiB; the original remains materializable.
- Vision fallback is allowed only for a clear unsupported-content signal: HTTP 415, or 400/422 text that identifies vision/image/multimodal/content-part support. Unrelated 4xx errors propagate.

#### Mutation, revision, and verification

- All `apply_patch`, `materialize_resource`, and `shell_run` operations use the container mutation lease.
- `TaskContract.workspaceRevision` is task progress metadata; `AgentWorkspaceRuntime.getWorkspaceRevision()` is the authoritative container state used for checkpoints, recovery drift, child notifications, and completion.
- Shell process completion forms an explicit runtime revision boundary because filesystem watch delivery may lag the process exit.
- Verification evidence binds to the post-command revision. Any later parent/child mutation or failed child verification invalidates the previous pass.
- Every foreground `shell_run` records pass/fail from its real exit status on the post-command authoritative revision. A background `shell_run` is runtime/process progress: it preserves the existing `changedWorkspace` flag but invalidates an earlier pass. Filesystem watch or shell-exit revision drift still converts the task to changed/unverified before completion.
- `complete_task` is the preferred structured completion path and requires truthful evidence. A non-empty plain assistant response is also a completion attempt for every task type; it may finish only after the shared plan/revision/verification gate passes.
- Immediately before explicit or plain-response completion, reread the authoritative runtime revision. If a plain response is rejected, do not project it as a durable final message; clear transient output, inject one actionable recovery instruction, and continue inside the existing budgets.
- Missing/stale verification recovery must name `shell_run`, foreground mode, a truthful task-relevant check, exit code 0, final-write ordering, and the completion retry action.
- Runtime code must not whitelist or parse command names, package scripts, arguments, ports, or shell composition to determine verification. The Agent prompt requires relevant evidence, unmasked failures, and re-verification after later mutation.

#### Process discovery and lifecycle

- Every registered process retains exact `(sessionId, runId, containerId)` ownership. Runtime observe/input/stop methods still require that full original tuple.
- Root `process_list` queries only `{ sessionId, containerId }`, so a follow-up root Run can discover earlier-Run processes in the same conversation/container. Processes from another session or container never enter its result.
- Root observe/input/stop tools resolve the selected registered Agent process ID from that scoped list, then pass the registry entry's original full ownership to the runtime. Do not guess OS PIDs or kill by port when a registered process exists.
- Delegated roles do not receive cross-run process management tools. Cancellation continues to call `stopRun` with the cancelling Run's exact ownership and does not stop an earlier completed Run's service.
- Successful explicit `stopProcess` kills/removes the registry entry, advances and flushes the process-exit revision exactly once, and resolves only after the boundary is durable. The later natural-exit callback detects the missing registry entry and must not advance it a second time.
- `process_stop` compares the task revision with the runtime revision before stopping and expects exactly one explicit-stop revision. Pre-existing drift or any additional revision during shutdown becomes changed/unverified; otherwise it synchronizes the process-only task to the post-stop revision so a truthful final response does not loop on a synthetic workspace change.
- Agent shell launches and interactive terminal launches share one runtime service registry. Every launch records a runtime-only launch ID, source, container, command, handle, status, and start time; Agent launches also retain session/run/process IDs.
- Managed launch environments preload `.sunam/runtime/service-hook.cjs` with `SUNAM_LAUNCH_ID`, `SUNAM_CONTAINER_ID`, and `SUNAM_SERVICE_EVENT_FILE`. The hook records validated JSONL `listening`/`closed` events from `net.Server.listen` with the actual Node PID and port. Runtime files live outside `.sunam/workspaces/c-*` and never enter project snapshots.
- WebContainer `port`/`server-ready` events are authoritative for open/close visibility. Listener JSONL supplies ownership only; UI/runtime never parse commands or infer a PID from a port number.
- Port transitions are `open -> identifying -> managed|orphaned`, and `managed -> stopping -> removed|orphaned`. A live launch handle or validated current-lifecycle listener PID is required for normal stop.
- `orphaned` is an exceptional recovery state for legacy/corrupt/uninstrumented listeners. Its only guaranteed close path is a user-confirmed global runtime restart: flush every snapshot first, dispose runtime, teardown WebContainer, clear both singleton layers, then boot a new pair. Snapshot failure is fail-closed and must not call teardown.
- Provider remounts subscribe/unsubscribe from the runtime singleton; they do not create a new process registry around a retained WebContainer and do not dispose the singleton on ordinary React cleanup.

#### Between-turn checkpoint synchronization

- The complete post-tool snapshot/Run/event/checkpoint stage has an independent abort-aware watchdog. It covers the persistence calls as well as `flushWorkspace`; the outer Run deadline alone is not sufficient because IndexedDB and snapshot promises may ignore AbortSignal.
- Before waiting, project the Run as `observing`. On timeout/error, set `run.error` and `phase = failed`, call `onRunChange` immediately, then stop only the failing Run's owned processes.
- Failure Run/event persistence is bounded best-effort after the UI projection. A hanging repository must not keep React showing an active Run. The timed-out operation receives an internal abort signal and checks it after every uninterruptible await so it cannot later append stale observing/checkpoint events.
- Never overwrite the previous successful checkpoint from the failure path. Cancellation still waits for child/task terminal persistence according to the existing parent-cancellation contract; only status persistence is best-effort bounded.

#### Subagents and cancellation

- Child Runs inherit only the compressed parent summary, Task Contract, resource manifest, authoritative revision, and explicit delegated goal. Never copy the parent transcript.
- Depth is 1; at most 6 child Runs/root and 3 concurrent `explore` Runs. `implement` and `verify` are exclusive.
- `explore` is read-only; `implement` may patch/materialize within `writeScope` but cannot shell; `verify` may run foreground shell checks and cannot patch or start background processes.
- Child Run budget is 20 model turns, 50 tool calls, 5 minutes. Root family budget is 90 turns, 225 calls, 15 minutes.
- Persisted delegated-task IDs are internally unique. A repeated model `taskId` is a label, not a database key.
- Parent cancellation cascades to children and owned processes and waits for terminal child/task persistence before the parent records cancellation.

#### `sunam-v3` durability

- Production opens only `sunam-v3`; it never opens, migrates, deletes, or falls back to `sunam-v2`. Local Storage keys may remain `sunam_v2_*` for settings continuity.
- Stores are `workspace`, `runs`, `events`, `checkpoints`, `terminalHistory`, `snapshots`, `quarantine`, `resources`, and `agentTasks`.
- Events are append-only. Session and Run pages are stable and capped at 250 records.
- Checkpoints overwrite by `runId`; one Run cannot accumulate multiple transcript copies.
- Run, Event, Checkpoint, Message, Resource, and delegated-task payloads pass deep guards. Invalid records retain their raw value in quarantine and return an issue.
- Persistence sanitizers recursively remove Blob, File, ArrayBuffer, data URLs, long Base64, and secrets before writing Runs/events/checkpoints.
- Ordinary workspace saves, reset, and session/container deletion share the workspace serialization queue. Deletion first cancels and waits for matching Runs, then changes workspace metadata and related records in one transaction.
- Snapshot export excludes dependencies, VCS, build/coverage/Playwright output, and caches before serialization, then applies a defensive tree sanitizer. Limits are 10,000 files and 100 MiB; overflow preserves the previous complete snapshot.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Unknown model | Use conservative 32k profile; do not assume Claude/GPT constants. |
| SSE delta has `content: null` and string `reasoning_content` | Accept the frame, normalize null content to no-op, and accumulate/persist the reasoning string. |
| Optional provider content/reasoning field is non-null and non-string | Reject or ignore the malformed frame at the validated adapter boundary; never cast it into `Message`. |
| Context still exceeds effective window after semantic attempts | Deterministic clipped summary, bounded recent groups, `fallbackReason`, no fourth model call. |
| Abort during compaction/model/tool/subagent wait | Propagate the cancellation domain; do not convert it to a retryable failure. |
| Tool-call group lacks a matching result | Remove the invalid group from provider history or retain safe plain assistant text only. |
| Resource ID belongs to another session | Reject as unavailable; never return metadata/body or materialize it. |
| Declared image/text MIME fails sniff/decode | Reject the whole resource batch before persistence. |
| Provider returns unrelated 400/422 | Propagate `LLMError`; do not mark vision unsupported or retry text-only. |
| Path escapes active container or write scope | Reject before any write. |
| Process ownership tuple mismatches | Observe returns `null`; input/stop returns `false`; no process side effect. |
| Root lists processes after an earlier Run completed | Return running processes only from the same session/container, including original owner Run IDs and registered process IDs. |
| Requested process belongs to another session/container | Omit it from `process_list`; observe/input/stop report scoped not-found and perform no side effect. |
| Explicit stop succeeds | Kill/remove the registered process, advance/flush one exit revision, synchronize the task, and allow process-only completion. |
| Process exits between list and observe/input/stop | Return a refreshable race message naming `process_list`; never claim that an inaccessible process was stopped. |
| Port opens before its listener record is consumed | Show `identifying`; reconcile by launch ID/PID when either event arrives, independent of ordering. |
| Port has no valid current-lifecycle launch after reconciliation | Mark `orphaned`; show the global restart warning, not a normal stop button. |
| Managed stop does not produce an authoritative port close | Mark `orphaned` after the bounded stop window. |
| Forced restart snapshot flush fails | Keep the current runtime/WebContainer alive; do not dispose or teardown; surface the error. |
| Forced restart tears down but the next boot fails | Clear the discarded runtime from React/singleton readiness and surface the boot error. |
| Post-tool snapshot or Run persistence never settles | Watchdog projects recoverable `failed`, stops Run-owned processes, bounds failure persistence, and preserves the last successful checkpoint. |
| Verification revision differs from current runtime revision | Mark unverified and require new verification. |
| Foreground command uses a custom script, arbitrary arguments/port, redirects, or compound shell syntax | Do not parse or reject it; record its real exit status on the post-command revision. |
| Foreground command exits non-zero or times out | Record failed verification and invalidate the previous pass. |
| Model chooses forced success or an unrelated command as evidence | Treat as a prompt/evidence truthfulness violation; runtime still records the actual terminal result without a brittle command parser. |
| Plain completion has an unfinished plan or missing current-revision verification | Withhold the draft from durable/UI messages, clear transient output, emit actionable recovery, and continue within the existing budget. |
| Background server starts and the authoritative revision remains unchanged | Record process progress without creating a workspace mutation; allow guarded completion while the owned process remains alive. |
| Resume checkpoint revision/tail differs from durable current state | Inject drift notice; rebuild as a new Run; treat old reads/verification as stale. |
| Snapshot exceeds file/byte cap or write fails | Preserve previous complete snapshot; report a recoverable persistence error; queued follow-up remains runnable. |
| IndexedDB record fails deep validation | Quarantine raw record and return an issue; never silently coerce or use memory fallback. |
| Delete transaction fails | Surface persistence error and do not report durable deletion success. |

### 5. Good / Base / Bad Cases

- Good: A root delegates three read-only explorations, waits for structured notifications, serially applies one scoped implementation, runs foreground verification, rereads the container revision, and completes with revision-bound evidence.
- Good runtime edge: A root starts an owned background server, completes any required plan, returns one plain final response, and finishes without stopping the process or demanding unrelated workspace verification.
- Good lifecycle edge: A later root Run calls `process_list`, selects the registered service from the same session/container, stops it with its original ownership, observes the port/process disappear, and returns one final response.
- Good service edge: A Node server started from the user terminal inherits a terminal launch ID, reports its exact listener PID, appears as managed, and the port-row stop button terminates that PID without killing unrelated ports.
- Good recovery edge: An old unowned port becomes orphaned; the user confirms the global impact; snapshots flush successfully before teardown and the replacement runtime boots with an empty port registry.
- Good watchdog edge: A tool result is durable but snapshot flush hangs; the Run becomes visibly recoverable-failed within the checkpoint deadline and no stale checkpoint replaces the previous one.
- Good development edge: A root runs a custom validator on the project's actual port, performs a foreground inspection, and completes from the latest successful exit evidence without a parser-specific wrapper script.
- Base: A short text-only Run stays below budget, uses no resources/subagents, writes one Run/event stream/checkpoint, and completes without invoking compaction.
- Good provider edge: A reasoning delta with `content: null` reaches `assistant_delta`, and the final durable assistant message retains the same accumulated `reasoning_content`.
- Bad: A component stores an uploaded `File` in a message event, a provider branch is added inside `AgentEngine`, two writers mutate the same container outside the lease, or resume trusts `TaskContract.workspaceRevision` without reading runtime state.
- Bad lifecycle edge: A follow-up Run guesses an OS PID, kills by port, or receives processes from another session/container instead of resolving a registered Agent process ID.
- Bad service edge: `DualTerminal` creates its own WebContainer port listeners or directly spawns `jsh`, producing a service list with no launch ownership.
- Bad recovery edge: A force-restart button tears down first and attempts snapshot persistence afterwards, or hides snapshot failure and reports success.
- Bad watchdog edge: A Run-wide timer only aborts model requests while `reflectTask()` awaits an unbounded snapshot/IndexedDB promise.
- Bad provider edge: A strict string-only object schema silently drops an entire valid reasoning delta because an optional sibling field is null.

### 6. Tests Required

| Change area | Minimum tests and assertion points |
| --- | --- |
| Context/profile/token logic | Complete tool grouping; media stripping; micro-compaction safety; PTL three-attempt bound; abort; deterministic circuit; one oversized round ends inside effective window; task/resource/file/subagent rehydration. |
| Model adapter | Exact outbound content parts; nullable content/reasoning delta normalization; final plain-message reasoning preservation; resource session ownership; usage mapping/estimation; successful vision caching; clear unsupported-vision retry; unrelated 400/422 does not retry. |
| Resources | Count/size limits including existing IDs; atomic batch failure; same-session SHA dedupe; cross-session rejection; MIME spoof; invalid UTF-8; image 2048/1.5 MiB limits; Blob absent from ledger. |
| Runtime/revision | Every mutation path advances authoritative revision; verification binds after shell exit; process ownership isolation; same-session/container cross-Run list/observe/input/stop; explicit-stop single revision boundary; launch/listener order reconciliation; exact listener PID provenance; managed/orphan/stopping transitions; snapshot-first restart fail-closed; singleton remount; materialize; snapshot pre-export exclusions; `pagehide`/dispose/checkpoint flush. |
| Completion | Explicit and plain responses share plan/revision/verification gates; actionable no-whitelist recovery guidance; arbitrary foreground checks/ports; failed-exit invalidation; rejected drafts are not projected; background server completion keeps the process alive; hanging post-tool synchronization becomes visibly failed and cancellation remains terminal. |
| Persistence | One checkpoint/Run; stable 250-event session and Run pagination; deep quarantine; sanitizer; session/container transaction scope; shared-resource survival; snapshot cap keeps previous value; failed active snapshot still permits queued follow-up. |
| Subagents | Depth/count/concurrency limits; global same-container mutation serialization; role/tool/write-scope rules; repeated task labels; family budgets; child failure/verification propagation; parent cancellation waits and stops owned processes. |
| UI/E2E | No manual compact control; non-disruptive compact note; resource cards use IDs; child tree/transcript lazy load; resume drift; cancel; multimodal fallback; managed-port stop button; orphan warning/confirmation/error; localized creation defaults; desktop/mobile visuals. |

Release-significant changes require `npm run check:all`. An optimization-freeze claim requires two consecutive full passes and actual inspection of new visual baselines.

### 7. Wrong vs Correct

#### Wrong: persist transport bodies in the event ledger

```ts
await repository.appendEvent({
  kind: 'message',
  message: { role: 'user', content: await file.text(), file },
});
```

#### Correct: persist the Blob once and reference its durable ID

```ts
await repository.saveResource(storedResource);
await repository.appendEvent({
  kind: 'message',
  message: canonicalizeMessage({
    role: 'user',
    content: 'Inspect the attachment.',
    contentParts: [{ type: 'file_resource', resourceId: storedResource.id }],
    resourceIds: [storedResource.id],
  }),
});
```

#### Wrong: authorize completion with task-local revision

```ts
if (task.verifiedRevision === task.workspaceRevision) finish();
```

#### Correct: bind completion to the runtime revision

```ts
await runtime.flushWorkspace(containerId);
const currentRevision = await runtime.getWorkspaceRevision(containerId);
if (task.verifiedRevision !== currentRevision) requireVerification();
```

#### Wrong: let checkpoint persistence own the visible terminal state

```ts
await runtime.flushWorkspace(containerId); // may never settle
await store.saveRun({ ...run, phase: 'failed' });
onRunChange(run);
```

#### Correct: project failure first and bound best-effort persistence

```ts
run.phase = 'failed';
run.error = checkpointError.message;
onRunChange(cloneRun(run));
runtime.stopRun(exactOwnership);
await bestEffortWithin(deadline, () => store.saveRun(run));
```

#### Wrong: hardcode project command semantics

```ts
if (!KNOWN_VERIFICATION_COMMANDS.some((pattern) => pattern.test(command))) reject();
```

#### Correct: bind foreground exit evidence and instruct truthfulness

```ts
const passed = !result.timedOut && result.process.exitCode === 0;
recordVerification({ command, passed, workspaceRevision: currentRevision });
// The system prompt requires a relevant check and forbids masked failures.
```

#### Wrong: kill a registered service by guessed port or current Run ownership

```ts
await runShell(`kill $(findPidForPort(port))`);
runtime.stopProcess(processId, currentRunOwnership);
```

#### Correct: discover the scoped registry entry and reuse its exact ownership

```ts
const process = runtime.getProcesses({ sessionId, containerId })
  .find((candidate) => candidate.id === processId);
if (!process) return scopedNotFound();
await runtime.stopProcess(process.id, {
  sessionId: process.sessionId,
  runId: process.runId,
  containerId: process.containerId,
});
```

#### Wrong: add provider behavior to the engine

```ts
if (model.includes('claude')) maxTokens = 200_000;
```

#### Correct: keep provider/profile behavior in the adapter

```ts
const profile = client.getContextProfile?.() ?? profileForModel('unknown');
```

#### Wrong: reject a valid reasoning frame because optional content is null

```ts
const deltaSchema = z.object({
  content: z.string().optional(),
  reasoning_content: z.string().optional(),
});
```

#### Correct: normalize nullable optional text at the wire boundary

```ts
const nullableDeltaText = z.string().nullable().optional()
  .transform((value) => value ?? undefined);

const deltaSchema = z.object({
  content: nullableDeltaText,
  reasoning_content: nullableDeltaText,
});
```

## Persistent design decisions

- Reliability and recoverability take priority over bundle cosmetics. Bundle work remains gated, but it cannot weaken validation, durable truth, or cancellation.
- Context management, media trimming, model capability detection, and reconstruction are automatic. The UI may report state but cannot require context housekeeping from the user.
- `sunam-v3` is an intentional clean-workspace boundary. Old v2 work data is preserved but not imported.
- Images and text are first-class resources; arbitrary binaries may persist/materialize only. New directly consumable types extend `ResourceProcessorRegistry`, not `AgentEngine`.
- The first subagent runtime supports coordinator + ordinary child Runs. Team/mailbox/recursive swarm/parallel writers remain out of scope until measured evidence justifies them.

## References

- `docs/agent-v2-design.md`
- `docs/refactor-acceptance.md`
- `src/features/agent-core/engine.ts`
- `src/features/agent-core/context.ts`
- `src/features/agent-core/subagentCoordinator.ts`
- `src/shared/contracts/agentRuntime.ts`
- `src/shared/contracts/message.ts`
- `src/entities/persistence/v3Repository.ts`
- `tests/unit/agentContext.test.ts`
- `tests/unit/v3Repository.test.ts`
- `tests/runtime/webcontainer.smoke.spec.ts`
