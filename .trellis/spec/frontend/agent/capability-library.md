# Capability Library

## Applicability

Read this leaf before **adding, moving, or gating an Agent tool**, registering a module/extension, touching the capability registry, changing the container availability model, or altering the chat-only degradation path.

## Required Behavior

### Injection invariant (compile-time)

Every tool the Agent may call must be declared through `defineTool` with a **required `capability`** field:

```ts
defineTool({
  name: 'my_tool',
  // ...
  capability: { module: 'my-module', defaultEnabled: true, dependencies?: ['other_tool'] },
});
```

- Missing `capability` is a **compile error** — a tool cannot reach the Agent without a capability declaration.
- `registerModule` re-validates that each tool's `capability.module` matches the module id (`injection invariant` holds for extensions too: a plugin cannot expose a tool without a declaration).
- Categories: `agent-runtime` (control-flow + subagent, `warnOnDisable: true`) / `virtual-container` / `resources` / `notes` (reserved extension) / `other` (genuine catch-all, must stay near-empty).
- `dependencies` auto-enables required tools (e.g. `process_*` depend on `shell_run`).

### Registry = module host

- `CapabilityRegistry` (singleton) is the single source of truth for what the Agent may perceive.
- `core` modules (agent-runtime / virtual-container / resources / other) are bootstrapped, **non-removable**; `extension` modules (MCP/third-party, id `ext:<pluginId>`) register/unregister at runtime — hot-pluggable.
- UI panel, engine allow-set, and system prompt all read the live registry.

### Tool allow-set

`resolveEnabledTools(config, availability)` derives the effective allow-set:

- Module master switch off → all its tools forced off.
- Module on → tool follows its config override or manifest default (overrides stored diff-only).
- `availability === 'restricted'` → the virtual-container module excluded entirely.
- Dependency closure re-adds required tools.

The engine receives this set (`enabledTools`) and intersects it with per-role child toolsets.

### Container availability & chat-only

- `CapabilityAvailability = 'enabled' | 'disabled' | 'restricted'`; session availability is `enabled | restricted` (restricted = boot failed, user may retry via the switch).
- When the container capability is off/restricted the agent still runs via a `CapabilityAwareRuntime` (chat-only): container methods no-op/empty, **resource methods always work through IndexedDB** (container-independent by design — attachments stay analyzable).
- Chat-only runs bind to the sentinel `CHAT_ONLY_CONTAINER_ID` (`__chat__`), never registered in the workspace store, never snapshot-materialized — persistence schema untouched.
- System prompt is capability-aware: chat-only sessions get a "no file system, no terminal" charter and never reference `shell_run`/workspace tools.
- Completion gate: when `containerAvailable === false` **or** `shellAvailable === false`, workspace-revision verification is skipped (no verification tool → must not deadlock).
- Close = real shutdown: `disposeWorkspaceRuntime()` flushes snapshots, tears down the WebContainer, and clears singletons; a re-open does a fresh boot and restores from the IndexedDB snapshot.

## Forbidden Behavior

- Do not add an agent tool without a `capability` declaration.
- Do not let the capability UI or allow-set drift from the registry (single source of truth).
- Do not make a core module removable.
- Do not treat "resource tools need a container" — read tools are IndexedDB-backed; only `materialize_resource` is container-bound.
- Do not let `VERIFICATION_RECOVERY_GUIDANCE` reference `shell_run` when it is not exposed.

## Required Validation

- `tests/unit/capabilityRegistry.test.ts`: bootstrap coverage, unique names, module-match validation, register/unregister, dependency closure, restricted exclusion, `other` threshold.
- `tests/unit/capabilityRuntime.test.ts`: method behavior matrix in both availability modes.
- `tests/component/capabilityPanel.test.tsx` / `capabilityWorkspace.test.tsx`: panel behavior incl. container restricted retry, run-lock, and composer enabled in chat-only.
- `scripts/check-architecture.mjs` coarse tripwire (`defineTool` count vs `capability:` declarations).

## Related Contracts

- [Architecture and data flow](./architecture-and-data-flow.md)
- [Revision, verification, and completion](./revision-verification-and-completion.md)
- [Persistence and snapshots](./persistence-and-snapshots.md)
- Developer guide: `docs/extension-development.md`
- Contracts: `src/shared/contracts/capability.ts`, `src/features/agent-core/capability/*`, `src/features/runtime/CapabilityAwareRuntime.ts`, `src/features/runtime/containerAvailability.ts`
