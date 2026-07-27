# Batch And Exhaustive Changes Guide

## Use When

- changing a discriminated union, constant, event kind, action, or config used in several files;
- applying a mechanical edit across branches or consumers;
- updating reducers, projectors, guards, schemas, fixtures, and docs together.

## Before Editing

1. Count all current occurrences and list the owners/consumers.
2. Identify generated, test-only, archived, and production paths separately.
3. Find the canonical union/schema/constant before changing consumers.
4. Decide which branches must be exhaustive and which intentionally accept unknown input.

## During Editing

- Update the owning type/schema first, then compiler-visible consumers, runtime guards, persistence validators, projectors, fixtures, and documentation.
- Prefer exhaustive `switch` plus a `never` assertion for closed internal unions.
- At external boundaries, validate unknown values and return an explicit issue rather than asserting exhaustiveness.
- Preserve existing default/fallback semantics only when the input contract remains open.

## After Editing

```bash
rg "old_symbol_or_literal" src tests .trellis/spec
rg "new_symbol_or_literal" src tests .trellis/spec
```

Compare counts and inspect every remaining old occurrence. A successful search replacement is not evidence that runtime guards, delete scopes, recovery, and UI projections agree.

## Warning Signs

- an `else` branch silently maps a new case to an unrelated existing case;
- production and tests define parallel unions;
- one reducer updates derived state while another branch forgets it;
- fixtures compile only because of broad casts;
- batch edits touch generated/history files that should remain frozen.

## Follow Through

For events or persisted data, also read [Event log and projection boundaries](../cross-layer/event-log-and-projection-boundaries.md) and the exact owning code-spec leaf.
