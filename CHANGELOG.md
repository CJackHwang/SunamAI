# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — 2026-08-08

The 2026-08 release is the largest in the project's history: the execution engine was
rewritten on the **pi** framework, the container runtime was fully migrated to
**Succinix**, the old `AgentEngine` was deleted, and a standalone **settings page** was
added. The work was executed as the M / P / S / V / UX / audit task series (archived under
`.trellis/tasks/archive/2026-08/`).

### Added

- **Standalone settings page** (`SettingsPage`, UX3) with three tabs:
  - **Providers** — manage model providers (16 presets derived from `@earendil-works/pi-ai`
    providers: DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, Mistral, xAI, Cerebras, …),
    each with base URL, API key, default model and request API
    (`openai-completions` / `anthropic-messages`), plus a global conversation model with a
    "fetch models" list button.
  - **Personas** — reusable system prompts with model parameters (temperature / top-p /
    max tokens) and a model binding (`auto` follows the global model; or pinned to a
    specific provider + model). Enabled personas appear instantly in the chat model selector.
  - **About** — project info, GitHub repo, AGPL-3.0 license, and a direct **Succinix**
    project link.
- **pi engine as the only agent engine** (P1–P6 + PISWITCH): the pi framework
  (`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`) now drives chat, tool calls,
  subagents and compaction. The pi runtime is lazy-loaded so it does not enter the initial
  bundle.
- **AgentDriver abstraction** (P6): the UI talks to an `AgentDriver` interface; the built-in
  **pi driver** is the default, with experimental ClaudeCode / Codex CLI bridges behind the
  same interface.
- **pi IndexedDB session backend** (P2): pi sessions persist to IndexedDB; after a refresh
  the agent history is rebuilt from the latest summary + retained tail + subsequent messages.
- **pi subagent orchestration** (P4): `spawn_subagent` / `wait_subagents` /
  `message_subagent` run as independent pi Agent instances (up to 3 concurrent, 6 per root,
  depth 1) with real per-child budget counters.
- **pi context compaction** (P5): automatic compaction at 90% of the effective context
  window (model-profile-derived, conservative 32k for unknown models) — a summary plus a
  retained tail is written back to the persisted session before the turn proceeds.
- **Succinix container environment** (M1–M7): the agent and user terminal now execute through
  Succinix's TerminalExecutor file RPC (`/cmd.json` → `/result-<id>.json`, one result file
  per request) — real Node.js for `node|npm|npx`, a resident Pyodide daemon for
  `python|pip`, and the Lifo Unix userland for everything else, sharing one filesystem.
- **Cross-container process isolation** (CISOL): the Succinix process table carries a
  `scope` (`system` / `container` / `unknown`) and optional `containerId`; Sunam filters
  processes per virtual container, blocks cross-container kills, and marks protected system
  processes non-stoppable in the UI.
- **Dual-layer snapshots** (M3): Succinix automatically snapshots the container filesystem
  to IndexedDB (`succinix-persist`, text-first, honest exclusions) while Sunam keeps agent
  session checkpoints in `sunam-v3` — refresh restores both files and conversation.
- **User terminal on the full Succinix UI** (V2TERM): the in-browser user terminal boots the
  complete Succinix system (self-checks + `guest` prompt + interactive commands).
- **pi tool calls in chat bubbles** (PITOOLUI): assistant tool calls and their results are
  rendered inline in the chat message bubble (tool-call conversion + execution-event
  passthrough).
- **UX refinements**: sidebar defaults to half-screen and the "Sunam computer" defaults to
  the terminal tab (UX1); the terminal is shown as soon as the WebContainer is ready and the
  restricted state persists (UX2).
- **18 agent tools** (M4 refactor): workspace (`workspace_tree` / `read_file` /
  `search_workspace`), process (`run_command` / `manage_process` / `read_user_terminal`),
  resources (`list_resources` / `read_resource_text` / `read_resource_image` /
  `materialize_resource`), subagents (`spawn_subagent` / `wait_subagents` /
  `message_subagent`) and control (`update_plan` / `report_progress` / `ask_user` /
  `ask_parent` / `complete_task`). Every tool carries a compile-time `capability`
  declaration.

### Changed

- **Old engine removed** (PISWITCH): `AgentEngine`, `AgentFamilyCoordinator` and the
  `subagentCoordinator` were deleted; pi is the only execution kernel. Historical persisted
  `implement | verify` records remain readable and display as `task`.
- **runShell replaced by Succinix file RPC** (M1): agent commands no longer spawn `jsh`;
  they go through Succinix's TerminalExecutor with timeout passthrough, background `spawn`
  on the unified process table, and shell-metacharacter fusion handled by the Succinix host.
- **Ports & services aligned with Succinix** (M2): port events come from the Succinix port
  registry; the services panel stops managed ports precisely (never guessing a PID from a
  port number).
- **`apply_patch` removed** (M4): file writes now go through `run_command` (heredoc / `sed` /
  `node fs`), which is more flexible.
- **Process UI bound to the Succinix process table** (M5): protected system processes are
  marked and cannot be stopped from the UI; user processes stop as before.
- **Naming unified to Succinix** (M7): user-visible text now says **Succinix** for the
  container environment (the capability panel notes "Container environment"); WebContainer
  remains only where technically necessary (imports, protocol details).
- **Multi-workspace isolation retained** (M6): virtual-directory container semantics are
  preserved with a cwd race guard; two virtual containers stay mutually invisible.
- **Cross-container process queries and kills are filtered/blocked** (CISOL): a container's
  process list only shows its own processes; cross-container `kill` is rejected.
- **Doc structure rebuilt** (this release): bilingual README / CHANGELOG / CONTRIBUTING /
  FEATURES, updated architecture and agent-runtime design docs, stale docs annotated.

### Fixed

- **P1–P3 audit fixes**: UI message recovery for pi events, honest subagent degradation
  markers, and bundle-gate compliance for the pi lazy-load channel.
- **P4–P6 audit fixes**: subagent sentinel rename, real usage statistics (model turns / tool
  calls), and driver documentation comments.
- **V1 audit H1 fixes**: CRLF semantics, foreground-process visibility, and the CI
  container-chain gate.
- **M2 re-review fixes**: unit coverage for port events arriving first, and the orphan
  port back-date window.
- **M3–M5 batch audit M-1 fixes**: live specs updated to the new `run_command` /
  `manage_process` tool names.
- **Final audit fixes** (FINALFIX): stale comment updates, a Succinix host signal-reclaim
  race guard, escape-hatch wiring, provider `api` propagation on preset selection, and the
  persona system-prompt taking effect.

### Removed

- **`AgentEngine` / `AgentFamilyCoordinator` / `subagentCoordinator`** — the pre-pi agent
  execution stack.
- **`apply_patch`** tool — superseded by `run_command`.
- **`jsh`** as the agent command runtime — superseded by the Succinix TerminalExecutor.
- **User-visible "WebContainer" naming** for the environment — now **Succinix** (M7).
- **`HeyMean拷貝/` residual copy** and the root **`TASK-*.md` / plan** files — archived
  under `.trellis/tasks/archive/2026-08/` or removed.
