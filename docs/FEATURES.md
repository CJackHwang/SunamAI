# Sunam — Supported Features & Capabilities

> **Authoritative inventory of what Sunam supports today.** Every capability below is
> implemented and verified — nothing here is aspirational or speculative. The **Source** column
> cites the implementing TASK series (see the CHANGELOG for details) or the authoritative
> document that records it. 中文版：[FEATURES.zh-CN.md](FEATURES.zh-CN.md).

## 1. System overview

Sunam is a **browser-native AI coding assistant**: a Chromium browser tab that pairs the **pi**
agent engine (`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`) with the **Succinix**
container environment (`@succinix/engine` over WebContainer). No installation, no backend, no
model hosting — the browser talks directly to the model provider you configure.

| Item | Value | Source |
| ---- | ----- | ------ |
| Product | Sunam (SunamAI) | README |
| Agent engine | pi (the only engine; old `AgentEngine` removed) | P1–P6, PISWITCH |
| Container | Succinix TerminalExecutor (WebContainer + Lifo + real Node.js) | M1, README |
| Request APIs | `openai-completions` / `anthropic-messages` | P1, R4 |
| Settings | Standalone page: Providers / Personas / About | UX3 |
| License | **AGPL-3.0** © CJackHwang | README, LICENSE |
| Browser | Chromium family only (Chrome/Edge) + COOP/COEP cross-origin isolation | README |

## 2. Agent engine (pi)

| Capability | Detail | Source |
| ---------- | ------ | ------ |
| **pi as the only engine** | Chat, tools, subagents and compaction all run on pi; the runtime is lazy-loaded (not in the initial bundle) | P1, PISWITCH, PITOOLUI |
| **Driver abstraction** | `AgentDriver` interface; default `PiDriver`, experimental ClaudeCode / Codex CLI bridges | P6 |
| **18 agent tools** | workspace (`workspace_tree` / `read_file` / `search_workspace`), process (`run_command` / `manage_process` / `read_user_terminal`), resources (`list_resources` / `read_resource_text` / `read_resource_image` / `materialize_resource`), subagents (`spawn_subagent` / `wait_subagents` / `message_subagent`), control (`update_plan` / `report_progress` / `ask_user` / `ask_parent` / `complete_task`) | M4, P3 |
| **Event bridge** | pi events → `AgentEvent` stream (streaming deltas, tool calls, subagent passthrough), persisted to v3 best-effort | P1, R1, PITOOLUI |
| **Auto context compaction** | 90% of effective window triggers compaction; summary + retained tail persisted; refresh rebuilds from latest summary + tail | P5 |
| **Subagents** | up to 3 concurrent (6 per root, depth 1); `explore` read-only / `task` full non-delegating; independent budget counters | P4 |
| **Attachments** | 8 per message (2/10/20 MiB, 50 MiB batch), SHA-256 dedup, image model copy ≤1.5 MiB, multi-modal pi user messages | R1 |
| **Capability declarations** | every tool carries a compile-time `capability` declaration; panel switches + allow-set all read the registry | M4, capability |
| **User terminal** | full Succinix system UI in the browser (self-checks + `guest` prompt + interactive commands) | V2TERM |

## 3. Container environment (Succinix)

| Capability | Detail | Source |
| ---------- | ------ | ------ |
| **File RPC execution** | agent + user terminal run through Succinix file RPC (`/cmd.json` → `/result-<id>.json`, one result file per request) | M1 |
| **Real runtimes** | `node|npm|npx` → real Node.js; `python|pip` → resident Pyodide daemon; everything else → Lifo Unix userland; one shared filesystem | M1, Succinix |
| **Cross-container process isolation** | process table carries `scope` (`system`/`container`/`unknown`) + `containerId`; per-container queries, cross-container kills blocked, protected system processes non-stoppable | CISOL |
| **Ports & services** | port events from the Succinix port registry; managed ports stopped precisely; orphaned ports require confirm + snapshot-first global restart | M2 |
| **Dual-layer snapshots** | Succinix file snapshot (`succinix-persist`, text-first) + Sunam agent checkpoint (`sunam-v3`); refresh restores both | M3 |
| **Multi-workspace isolation** | virtual-directory containers stay mutually invisible; canonical workdir `/home/workspace/<containerId>` | M6 |
| **Naming** | user-visible container text is **Succinix**; WebContainer remains only where technically necessary | M7 |

## 4. Settings page

| Panel | Detail | Source |
| ----- | ------ | ------ |
| **Providers** | 16 presets derived from `@earendil-works/pi-ai` providers; base URL / API key / default model / request API per provider; global conversation model + "fetch models" | UX3, R4 |
| **Personas** | reusable system prompts + model params (temperature/top-p/max tokens) + model binding (`auto` follows global model, or pinned provider+model); instant in the chat model selector | UX3, R5 |
| **About** | project info, GitHub repo, AGPL-3.0 license, **Succinix project link** | UX3, R6 |

## 5. Product

- **Multilingual UI** — 中文 / English / 日本語, installable PWA.
- **Chat / Computer / Capability Library** — the "Sunam computer" merges terminal, user shell,
  services and files into one view with a capsule dynamic island; capability library gives
  module-level and per-tool switches for what the AI can perceive.
- **Container three states** — `enabled` / `off` / `restricted` (boot failure). Off truly
  releases the container (flush snapshot → teardown); restricted degrades gracefully to chat-only.
- **Chat-only degradation** — `CapabilityAwareRuntime` keeps chat + resource tools working when
  the container is off/restricted; completion gate skips workspace verification when the shell is
  unavailable.
- **RunBoard** — plan, compaction status, subagent tree; child transcripts load on demand
  (last 250 events) only when expanded.

## 6. Persistence

| Data | Store | Notes |
| ---- | ----- | ----- |
| API keys, provider/persona config, language | Local Storage (`sunam_v2_*`) | never commit real keys |
| Sessions, runs, events, resources, terminal history, snapshots | IndexedDB `sunam-v3` (9 stores) | append-only events, single overwrite checkpoint per run |
| pi session history | IndexedDB `sunam-pi-sessions` (independent of v3) | single-tab single-writer; mutation log replayed on refresh |
| Container file snapshots | IndexedDB `succinix-persist` (Succinix) | text-first, honest exclusions |

- Refresh marks active parent/child runs as `interrupted`; resume creates a new Run and rebuilds
  the pi session from the latest summary + retained tail.
- Deleting a session/container cancels and awaits in-scope active runs before a single
  transaction; no data resurrects after delete.

## 7. Honest boundaries

Accepted constraints — not bugs, and never simulated:

| Boundary | Detail | Source |
| -------- | ------ | ------ |
| Browser-only, no backend | model keys are entered per-user in the browser; deployment must allow CORS + COOP/COEP | README |
| No vision fallback in pi | the old "retry with text when vision refused" probe was not carried into the pi channel; an image-capable model is required for image attachments | R5, README |
| `ask_user` / `ask_parent` are non-blocking in pi | the autonomous loop cannot pause for UI input; the question is returned as a tool result and the model asks in its reply | R4, README |
| `apply_patch` removed | file writes go through `run_command` (heredoc / `sed` / `node fs`) | M4 |
| External CLI bridges experimental | ClaudeCode / Codex drivers are behind the same `AgentDriver` interface but not shipped as defaults; they require a local environment | P6 |
| Firefox / Safari / mobile unsupported | WebContainers requires Chromium + cross-origin isolation + SharedArrayBuffer | README |
| pi compaction has no deterministic fallback | if the LLM summarizer fails, the turn proceeds without compacting (does not block prompt) | P5, README |
| Resource limits | 8 per message, 2/10/20 MiB, 50 MiB batch; images ≤2048px, model copy ≤1.5 MiB | R1 |
| Snapshot limits | 10,000 files / 100 MiB cap; binary/unreadable files skipped (text-first) | M3, README |

## 8. Testing

- **Unit / component** — Vitest: pure logic + React components against mocks / fake IndexedDB.
  Coverage gate: statements/functions/lines ≥85%, branches ≥80% on core files.
- **E2E** — Playwright end-to-end flows (config gates, settings, session/container CRUD,
  attachments, compaction, checkpoint resume, subagents, transcript isolation).
- **Visual** — desktop 1440×900 / mobile 390×844, diff ≤0.2%.
- **Runtime** — real Succinix/WebContainer acceptance: launch/PID/port registration, process
  isolation, canonical workspace visibility, snapshot export exclusions, parent-cancel cascade.
- **Gates** — `npm run check` (typecheck, lint, architecture, coverage, build, bundle) and
  `npm run check:all` (+ e2e, visual, runtime, production audit).

## 9. Quick start & docs index

```bash
npm ci
npm run dev          # http://localhost:7891 (COOP/COEP preconfigured)
```

Documentation family (English · 中文):

- **README** — overview, usage, architecture: [English](../README.md) · [中文](README.zh-CN.md)
- **FEATURES** — this document: [English](FEATURES.md) · [中文](FEATURES.zh-CN.md)
- **Architecture** — module responsibilities & dependency boundaries: [architecture.md](architecture.md)
- **Agent runtime design** — pi session / driver / persistence / compaction / subagents: [agent-v2-design.md](agent-v2-design.md)
- **CHANGELOG** — change history: [English](../CHANGELOG.md) · [中文](../CHANGELOG.zh-CN.md)
- **CONTRIBUTING** — how to contribute: [English](../CONTRIBUTING.md) · [中文](../CONTRIBUTING.zh-CN.md)
