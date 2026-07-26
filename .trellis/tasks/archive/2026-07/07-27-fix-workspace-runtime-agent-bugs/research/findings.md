# Repository findings

## Internal workspace path

- Canonical roots are intentionally `.sunam/workspaces/c-<id>` inside the WebContainer.
- File contents in the screenshot are normal project-root entries.
- The user-facing defect is that the file breadcrumb exposes the internal root; terminal/process displays already translate it to `/containers/<name>`.

## Port lifecycle

- `DualTerminal` listens to global WebContainer `server-ready` and `port` events.
- `ServicesPanel` cannot stop a port; it can only stop an Agent-owned process that still exists in `ProcessRegistry`.
- WebContainer's public `port` callback contains only `(port, type, url)`. It does not identify the owning process.
- The application already retains handles for Agent `shell_run`, but that registry is an in-memory `Map`; the interactive terminal bypasses it and directly spawns one long-lived `jsh` inside `DualTerminal`.
- Port events are also owned by `DualTerminal`, so the runtime process registry never joins a port to its launch source. This split explains a visible port with a process count of zero.
- Runtime/provider reconstruction creates a new `ProcessRegistry` around the singleton WebContainer. Registered handles are killed on normal disposal, but terminal descendants or detached/unregistered services can remain outside that cleanup domain.
- The normal fix is a runtime-owned service registry used by both Agent and terminal launches. A precise stop is possible when the application retained the relevant `WebContainerProcess` handle; a runtime restart remains the only public-API guarantee for a truly orphaned port.

## Localized resource defaults

- First workspace state, new sessions, new containers, empty-session reuse, and new-session detection all depend on hard-coded Chinese strings.
- Creation APIs need localized labels supplied at creation time, while reuse detection must recognize legacy defaults in every supported locale and preserve custom names.

## Agent between-turn stall

- After durable tool result events, `AgentEngine.reflectTask()` synchronously flushes the workspace snapshot before starting the next model turn.
- The global run deadline aborts the model/tool signal but does not race or interrupt snapshot export / IndexedDB persistence awaits.
- A stalled snapshot flush therefore leaves the run in an active phase indefinitely from the user's perspective.
- The fix should add an abort-aware bounded checkpoint synchronization stage and surface an explicit recoverable failure when it cannot finish.

## Prior completion work

- The archived `07-26-agent-completion-protocol` task added guarded no-tool completion and cross-run Agent process ownership.
- This task must preserve those completion and process-isolation contracts; it addresses UI service control and between-turn housekeeping stalls rather than weakening completion gates.

## Break-loop retrospective

- **Root cause category**: cross-layer contracts plus implicit assumptions. Async file reads assumed the selected root would not change; UI port events assumed a separate process registry could still own stop actions; creation code assumed Chinese was the canonical locale; Run duration assumed aborting model/tool work also bounded persistence awaits.
- **Architecture prevention**: the runtime is now the single launch/port owner; file navigation commits only for the current generation/root; workspace creation consumes explicit current-locale defaults; between-turn synchronization is independently bounded and projects failure before persistence.
- **Runtime prevention**: unowned ports are explicitly classified as orphaned and require snapshot-first confirmed restart instead of guessed PID termination.
- **Test prevention**: regressions cover stale reads, root-relative breadcrumbs, both event orderings, Agent-handle and terminal-PID stops, orphan classification, restart fail-closed, all locale defaults, and hanging checkpoint synchronization.
- **Knowledge capture**: executable contracts and wrong/correct examples live in `.trellis/spec/frontend/agent-runtime-and-persistence.md` and `.trellis/spec/frontend/state-management.md`; no template spec directory exists in this repository, so no template sync applies.
