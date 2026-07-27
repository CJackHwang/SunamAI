# Event Log And Projection Boundaries Guide

## Use When

- adding or changing an event kind/field;
- changing append-only persistence, pagination, recovery, or replay;
- changing a projector, RunBoard, chat/session status, or child/root view;
- introducing a config value that affects multiple derived states.

## Trace Every Consumer

An Agent event normally crosses:

```text
typed event producer
  -> append-only event store
  -> deep persistence guard/quarantine
  -> checkpoint/recovery sequence
  -> bounded session or Run page
  -> pure projector
  -> React/model context consumer
```

Check all of these before declaring the change complete:

- typed union and constructor;
- persisted guard and sanitizer;
- fixture/builders and serialization;
- latest-sequence and paging behavior;
- recovery and drift handling;
- root/child filtering;
- derived status cleanup on terminal/deletion paths;
- tests for unknown/invalid records and stale sequences.

## Projection Rules

- Append-only records are durable facts; projections remain recomputable.
- Root and child Run projections stay isolated, with independent recent-250 windows.
- A projector consumes typed/canonical events and never repairs malformed durable data with local casts.
- New derived state updates on every relevant event and resets on deletion, cancellation, resume, or family change as required.
- Durable schema changes include backward-read behavior or an explicit clean boundary; UI defaults do not silently become persisted truth.

## Warning Signs

- a new event compiles but is absent from guard or projector;
- UI reads raw `kind`/`action` with local assertions;
- pagination uses unstable offsets after append;
- one terminal path clears status while another leaves it active;
- recovery trusts task-local revision or an old event tail.

## Follow Through

Read [Agent architecture and data flow](../../frontend/agent/architecture-and-data-flow.md), [Checkpoint and recovery](../../frontend/agent/checkpoint-and-recovery.md), [Persistence and snapshots](../../frontend/agent/persistence-and-snapshots.md), and [Derived and paged state](../../frontend/state/derived-and-paged-state.md) as applicable.
