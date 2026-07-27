# Derived And Paged State

## Applicability

Read this leaf when changing event pagination, chat/RunBoard projections, child/root filtering, sidebar child preloads, or DOM windowing.

## Required Behavior

- Derive UI data from current events with memoized pure projectors.
- The main session timeline initially loads 250 events and pages older data; the DOM remains a current 250-message window.
- Root message/status/stream projections include depth-zero Runs only.
- Sidebar may preload lightweight child summaries to determine disclosure presence. Child transcripts load by Run only after selection, use an independent recent-250 window, and do not reset the root cursor.
- Persist a derived field only when recovery needs a durable fact. Resource metadata may be projected; Blob bodies remain in the resource store.

## Forbidden Behavior

- Do not read all event history for the first screen.
- Do not merge child transcripts/events into root model or UI projections.
- Do not store Blob, File, ArrayBuffer, data URL, or attachment bodies in messages, events, or checkpoints.
- Do not create a second source of truth for values derivable from durable records.

## Required Validation

- Unit/component tests prove stable 250-record pagination, independent root/child cursors, depth filtering, lazy child transcript loading, and bounded DOM projection.
- Resource projections prove IDs/metadata only.

## Related Contracts

- [State ownership and workspace store](./ownership-and-workspace-store.md)
- [Subagents and cancellation](../agent/subagents-and-cancellation.md)
- [Persistence and snapshots](../agent/persistence-and-snapshots.md)
