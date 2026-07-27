# Localized Creation Defaults

## Applicability

Read this leaf when adding or changing locale-dependent default session or container names. Persisted records remain plain strings; this contract does not add a schema version or rename existing resources.

## Required Behavior

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

- The page configures translated defaults synchronously before selector hydration effects.
- Hydrate/reload with no record, reset, `createSession`, and `createContainer` read the latest non-persisted defaults.
- Locale changes affect future creation only. Existing persisted or custom names are never rewritten.
- Empty-session reuse recognizes all supported historical zh-CN/en-US/ja-JP titles through one entity-owned helper; widgets do not compare translated literals.
- `sunam-v3` persists only final `title` and `name` strings.

### Validation And Error Matrix

| Condition | Required behavior |
| --- | --- |
| Translated default is blank | Fall back to the canonical built-in default; never create a blank resource. |
| No workspace record during hydrate/reload | Create initial resources with defaults current at that operation. |
| Locale changes after hydration | Preserve existing names; use new defaults only on later create/reset. |
| Historical localized empty title | Apply the existing empty-session reuse rule. |
| User-defined title | Never treat it as reusable merely because locale changed. |

Good: Japanese configured before hydrate creates `新しい会話` and `新規コンテナ`; later English creations use English without changing custom names. Base: Chinese defaults keep the same record shape. Bad: a widget checks `title === '新对话'` or locale switching renames persisted records.

## Forbidden Behavior

```ts
// Wrong: UI literal owns domain behavior.
const isNew = session.title === '新对话';

// Correct: entity helper owns historical default recognition.
const isNew = isDefaultSessionTitle(session.title);
```

- Do not persist translated configuration separately or migrate the v3 schema for defaults.
- Do not rewrite existing custom or localized resources on locale change.

## Required Validation

- Unit: initial hydrate, later create, reset, unique suffixes, blank fallback, all legacy titles, and custom-name preservation.
- Component/E2E: fresh workspaces in supported locales and future-only effects after language switching.
- Schema: v3 guards accept the unchanged record shape.

## Related Contracts

- [State ownership and workspace store](./ownership-and-workspace-store.md)
- [Persistence and snapshots](../agent/persistence-and-snapshots.md)
