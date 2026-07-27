# SunamAI Engineering Guidelines

- [context-curation.md](context-curation.md)

This directory is the project-specific engineering source of truth for future Trellis tasks. The rules describe the current React 19, WebContainer, Agent Core, and IndexedDB v3 implementation. They are intentionally stricter than generic frontend guidance because a UI change can cross runtime, persistence, and recovery boundaries.

## Guide index

| Guide | Use it for |
| --- | --- |
| [Directory structure](./directory-structure.md) | File placement, naming, and public module boundaries |
| [Architecture and boundaries](./architecture-and-boundaries.md) | The enforced dependency graph and cross-feature composition |
| [Component guidelines](./component-guidelines.md) | React components, props, styling, accessibility, and lazy boundaries |
| [Hook guidelines](./hook-guidelines.md) | Custom hooks, effects, async work, and cleanup |
| [State management](./state-management.md) | Local UI state, workspace state, runtime state, and persistence |
| [Type safety](./type-safety.md) | Strict TypeScript, contracts, validation, and canonicalization |
| [Agent runtime and persistence](./agent-runtime-and-persistence.md) | Agent execution, resources, subagents, revision gates, and sunam-v3 |
| [Quality guidelines](./quality-guidelines.md) | Required checks, testing, documentation, and forbidden shortcuts |

## Project invariants

- Production dependencies flow only through `shared → entities → features → widgets → pages → app`.
- Feature modules do not import another feature's internal implementation. Cross-feature composition belongs in a widget or uses a shared contract/public entry.
- Production workspace data uses `sunam-v3`. The application must not open, migrate, delete, or silently fall back to `sunam-v2`.
- External and persisted data is untrusted until it passes Zod or project guard validation.
- Agent Core, WebContainer runtime, persistence, and React projection remain separate responsibilities.
- Workspace mutations participate in the real container revision and mutation lease; completion and verification bind to that revision.
- `npm run check` is mandatory after source changes. Use `npm run check:all` for release-significant runtime, persistence, Agent, visual, or workflow changes.
- Architecture, persistence, public behavior, dependencies, assets, gates, and supported workflows must be documented in the same change.

Primary evidence: `docs/architecture.md`, `docs/agent-v2-design.md`, `docs/refactor-acceptance.md`, `scripts/check-architecture.mjs`, and `package.json`.
