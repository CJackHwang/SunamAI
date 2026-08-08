# Contributing to Sunam

Thanks for your interest in contributing. Sunam is a browser-native AI coding assistant
built on the **pi** agent engine and the **Succinix** container environment. Please read
[AGENTS.md](AGENTS.md) first — it is the unified AI-engineering entry for this repository,
and the real project specs live under `.trellis/spec/`.

## Development Setup

Requirements: **Node.js 22** (the CI version), npm, and a modern **Chromium** browser
(Chrome/Edge) for anything that touches the container or the UI.

```bash
npm ci               # install exact dependencies from the lockfile
npm run dev          # start the dev server on http://localhost:7891
```

The dev server is preconfigured with the `Cross-Origin-Opener-Policy` /
`Cross-Origin-Embedder-Policy` headers that WebContainer requires. **Do not change the port
or remove these headers.** `npm run dev` also syncs the Succinix host runtime assets
(`predev` → `scripts/sync-succinix-assets.mjs`) and frees port 7891 if it is occupied.

Open <http://localhost:7891>, configure a provider in **Settings → Providers**, and you can
start a conversation.

## Project Layout

```
src/
  app/                 # root providers, global styles, bootstrap
  pages/               # page entries (MainPage, SettingsPage, ConfiguredPage)
  features/
    agent-core/        # pi engine, tools, events, drivers, compaction, subagents, capability
    settings/          # settings state + panels (providers / personas / about)
    runtime/           # Succinix container runtime, file RPC client, snapshots, process registry
    terminal-session/  # terminal tabs, services panel, agent terminal
    chat/              # chat UI, streaming, auto-scroll, motion
    file-manager/      # file manager, export
  entities/            # domain types + v3 persistence (IndexedDB)
  shared/              # contracts, i18n, config stores, browser utilities, UI
  widgets/             # cross-feature compositions (workspace, sidebar, capability, settings)
tests/
  unit/                # Vitest unit & component tests
  e2e/                 # Playwright end-to-end flows
  visual/              # Playwright visual regression
  runtime/             # real Succinix/WebContainer acceptance
scripts/               # sync, architecture/bundle/check gates
.trellis/              # Trellis workflow (spec / tasks / workspace)
```

## Design & Coding Standards

- **TypeScript strict** is required, with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` and `noImplicitReturns`. Run `npm run typecheck` (0 errors).
- **Trellis workflow**: the project is managed by Trellis. Read `.trellis/workflow.md` and
  the relevant spec leaf under `.trellis/spec/` **before** writing code in a layer. Follow
  the task lifecycle (`python3 .trellis/scripts/task.py …`) — do not bypass it. `AGENTS.md`
  is the entry; do not create a second `AGENTS.md` under `.agents/`.
- **Architecture boundaries**: `shared → entities → features → widgets → pages → app`.
  Features interact only through public entries or `shared/contracts`. Never import another
  feature's internal types. `scripts/check-architecture.mjs` enforces this inside
  `npm run check`.
- **`AgentWorkspaceRuntime` is the sole boundary** between the agent core and the container.
  The agent never reaches into the Succinix runtime directly; process ownership is
  `(sessionId, runId, containerId)`.
- **Every agent tool must carry a `capability` declaration** through `defineTool`
  (module / defaultEnabled / warnOnDisable / dependencies) — missing it fails compilation.
  New tools first define schema, permissions, concurrency, timeout, result and persistence
  boundaries.
- **UI language is English** for all user-facing text; the app is localized via
  `shared/i18n` (中文 / English / 日本語). Add locale keys for every new string.
- **No emoji** in UI text, output, or comments that render to the user.
- **Dark, restrained theme** — follow the existing design tokens (motion, radius, colors)
  and the "professional, not toy-like" production feel. No new runtime dependencies without
  a spec.
- **Comments**: Chinese is fine for developer-facing comments; identifiers are English.

## Testing

Run at least `npm run check` before opening a PR. The full gate is `npm run check:all`.

| Command | Covers |
| --- | --- |
| `npm run typecheck` | strict TypeScript (0 errors) |
| `npm run lint` | Oxlint (0 errors) |
| `npm run test` | Vitest unit & component tests |
| `npm run test:coverage` | full core coverage gate (statements/functions/lines ≥85%, branches ≥80%) |
| `npm run check:architecture` | architecture + capability-registry audit |
| `npm run build` + `npm run check:bundle` | production build + initial/total JS and `dist` size gates |
| `npm run test:e2e` | Playwright end-to-end flows |
| `npm run test:visual` | desktop / mobile visual regression (diff ≤ 0.2%) |
| `npm run test:runtime` | real Succinix/WebContainer acceptance |
| `npm run check:audit` | production dependency high/critical = 0 |

- **Excerpts**: when a change is narrow (a pure-logic module, a single tool), running the
  relevant Vitest file or a focused Playwright spec is a reasonable local excerpt — but the
  PR must still state that `npm run check` (or `check:all` for UI/container changes) has
  been run on the final state.
- **New visual baselines**: regenerate baselines with the matching Chromium version, review
  them by hand, then run one verification pass without `--update`.
- **Runtime / network / browser limits**: if a check cannot run (no Chromium, no port
  permission, no network for `check:audit`), record it as **not executed / externally
  blocked** in the PR description — never mark it as passed.
- **Freeze gates**: core coverage and bundle thresholds are hard; the pi lazy-load channel
  is excluded from initial JS but still counted in total JS gzip.

## Pull Request Process

This project follows the Trellis task lifecycle. The canonical flow is:

1. **TASK spec** — a task describes the change, its Trellis spec leaves, the physical
   boundaries (what must not change), and its acceptance gates. Small fixes may reference an
   existing task instead.
2. **Implementation** — implement with tests where applicable; keep commits focused and
   atomic, using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat: …`, `fix(agent): …`, `docs: …`, `refactor(tests): …`, `chore: …`.
3. **Audit** — an independent read-only review (a separate agent or a maintainer) compares
   the implementation against the task spec. Address findings; re-run the gates on the final
   state. Do not skip the audit for large changes.
4. **Acceptance** — the gates pass (`npm run check`, plus `check:all` for UI/container
   changes), the audit is clean, and the task is archived under
   `.trellis/tasks/archive/`.

Practical steps for a pull request:

```bash
git checkout -b feat/your-change
# implement + tests
npm run check
git push -u origin feat/your-change
# open a PR describing the change, why it matters, and how you verified it
```

Keep the diff reviewable — split large changes into multiple PRs. A maintainer will review;
address feedback and re-run the gates.

## Documentation & Compatibility

- When architecture, persistence, public behavior, verification gates or dependency policy
  change, update the affected Markdown in `README.md` / `docs/` (English + 中文 where a
  bilingual document exists) and any affected `.trellis/spec/` leaf.
- Contributors must ensure their commits can be released under **AGPL-3.0-only**, and must
  preserve third-party copyright and license notices.
- Never add a runtime dependency without a spec leaf; dependency updates are evaluated
  separately per the [dependency advisory policy](docs/dependency-advisories.md).

## Questions

Open an issue for bugs and feature requests. For design questions, refer to
[AGENTS.md](AGENTS.md), the [architecture](docs/architecture.md) and
[agent runtime design](docs/agent-v2-design.md) docs, and the [README](README.md).
