# State Management

## State categories

Use local React state for transient view concerns: open menus, selected tabs, input text, loading flags, and temporary validation errors.

Use the external workspace store for shared sessions, containers, active IDs, pins, titles, and status. Components consume it through `useWorkspaceSelector` and mutate it through `useWorkspaceActions`.

Use Agent event/run persistence for execution truth. Chat messages, RunBoard state, checkpoints, and delegated task state are projections of durable Agent records, not a second global React store.

Use runtime-owned state for WebContainer files, processes, ports, terminal buffers, snapshots, and workspace revision.

## Workspace store rules

- Select the smallest needed slice. `Workspace.tsx` selects sessions and containers independently.
- Preserve no-change short circuits. Reapplying the same session status must not write IndexedDB or notify every subscriber.
- Ordinary saves, session/container deletion, reset, and reload share a serial queue. Reload waits for pending mutations.
- Session/container deletion first coordinates cancellation of active matching Runs, then performs metadata and related-data deletion transactionally.
- Surface persistence errors; never claim success from an in-memory-only fallback.

References: `src/entities/workspace/store.ts`, `useWorkspaceStore.ts`, `deletionCoordinator.ts`, and `tests/unit/workspaceStore.test.ts`.

## Scenario: localized workspace creation defaults

### 1. Scope / Trigger

Use this contract when adding or changing locale-dependent default session/container names. Persisted workspace records remain plain strings; this scenario must not add a schema version or rename existing user resources.

### 2. Signatures

```ts
interface WorkspaceCreationDefaults {
  sessionTitle: string;
  containerName: string;
}

interface WorkspaceStore {
  configureCreationDefaults(defaults: WorkspaceCreationDefaults): void;
}

function isDefaultSessionTitle(title: string): boolean;
```

### 3. Contracts

- The page configures translated defaults synchronously before selector hydration effects run.
- Hydrate-with-no-record, reload-with-no-record, reset, `createSession`, and `createContainer` read the latest non-persisted defaults.
- Locale changes affect future creation only. Existing persisted or custom names are never rewritten.
- Empty-session reuse recognizes all supported historical zh-CN/en-US/ja-JP default titles through one entity-owned helper. Widgets do not compare translated literals.
- `sunam-v3` continues to persist only final `title` and `name` strings.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Translated default is blank | Fall back to the canonical built-in default; never create a blank resource. |
| No workspace record during hydrate/reload | Create initial resources with the defaults current at that operation. |
| Locale changes after hydration | Preserve every existing name; use new defaults only on later create/reset. |
| Historical localized empty title | Eligible for the existing empty-session reuse/deduplication rule. |
| User-defined title | Never treat as reusable merely because the locale changed. |

### 5. Good / Base / Bad Cases

- Good: Japanese is configured before first hydrate, producing `新しい会話` and `新規コンテナ`; after custom renames, switching to English creates new English resources without touching custom values.
- Base: Chinese defaults create the same plain workspace record shape as before.
- Bad: `Workspace.tsx` checks `title === '新对话'`, or a locale switch maps over persisted resources and renames them.

### 6. Tests Required

- Unit: initial hydrate, later create, reset, unique container suffixes, blank fallback, all legacy titles, and custom-name preservation.
- Component/E2E: a fresh workspace in each supported locale renders the corresponding names; language switching affects only resources created afterwards.
- Schema regression: v3 workspace guards accept the unchanged record shape.

### 7. Wrong vs Correct

```ts
// Wrong: UI literal owns domain behavior.
const isNew = session.title === '新对话';

// Correct: entity helper owns historical default recognition.
const isNew = isDefaultSessionTitle(session.title);
```

## Derived and paged state

Derive UI data from current events with memoized pure projectors. The main session timeline initially loads 250 events and pages older data; the DOM remains a current 250-message window. Child transcripts load by run only when expanded.

Do not persist derived UI fields as new sources of truth unless recovery requires them. Resource metadata may be projected, while Blob data remains only in the resource store.

## State ownership anti-patterns

- Duplicating workspace sessions in component context.
- Updating arrays/objects when values are unchanged.
- Reading all event history to render the first screen.
- Treating a failed persistence write as successful local state.
- Storing Blob, File, ArrayBuffer, data URL, or attachment body in messages, events, or checkpoints.
- Letting a deleted Run continue and write records back after deletion.
