# Sunam Agent Cross-Layer Checklist

Use this short checklist before changing Agent Core, model adapters, resources, WebContainer runtime, subagents, recovery, or `sunam-v3`. The executable contract is [Agent Runtime and Persistence](../frontend/agent-runtime-and-persistence.md).

## Before coding

- [ ] Identify the owner: engine, context, model adapter, runtime, repository, or React projection.
- [ ] Trace the data through Message/tool -> Run/event/checkpoint/resource -> recovery/UI.
- [ ] Decide whether this changes the authoritative container revision or invalidates verification.
- [ ] Define session/container/run ownership for every new read, write, process, or resource ID.
- [ ] Budget cancellation, retry count, tool/model turns, payload size, and persisted record size.
- [ ] Search for the existing shared contract/guard before adding a local payload type.

## While coding

- [ ] Keep provider conditions in `AgentModelClient`, MIME logic in processors, IndexedDB logic in repositories, and cross-feature composition in widgets.
- [ ] Preserve complete assistant-tool/result groups during projection, compaction, and retry.
- [ ] Keep Blob/File/Base64/data URLs out of Runs, events, and checkpoints.
- [ ] Route every workspace mutation through path validation, the container lease, and authoritative revision updates.
- [ ] Make subagent writes serial and parent cancellation cascading/awaited.
- [ ] Keep fallbacks bounded and observable; never add a second unbounded retry owner.

## Before reporting completion

- [ ] Test good, base, invalid-input, cancellation, persistence-failure, and recovery-drift paths.
- [ ] Prove one checkpoint/Run and stable 250-record pagination when durable records change.
- [ ] Prove current runtime revision, not task-local counters, gates verification/completion.
- [ ] Prove resources are session-scoped and ledger records contain IDs only.
- [ ] Run `npm run check`; use `npm run check:all` for any release-significant cross-layer change.
- [ ] Update this code-spec, architecture/design docs, acceptance evidence, and visual baselines when public behavior changes.
