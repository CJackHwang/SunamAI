<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

# Context Curation

- A Spec leaf defines one independently applicable contract. Split it when a plausible task may need one contract without needing another.
- Layer `index.md` files are routers only: applicability, leaf links, and validation entry points. They must not duplicate leaf content.
- Complex research uses `index.md`, a concise `*-summary.md`, and full evidence under `research/evidence/`.
- Task `implement.jsonl` and `check.jsonl` reference exact Spec leaves and Research summaries only; they must never reference `AGENTS.md`, Spec or Research indexes, or `research/evidence/*`.
- Read full evidence only to challenge a conclusion, resolve a conflict, or investigate an unresolved question.


<!-- TRELLIS:END -->
