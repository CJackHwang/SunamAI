# Search And Abstraction Guide

## Use When

- adding a helper, component, constant, type guard, parser, or config value;
- writing logic similar to an existing branch;
- considering a shared abstraction.

## Questions

1. Which symbols, literals, payload fields, and behavior descriptions already exist?
2. Is there an authoritative owner in `shared`, `entities`, or the current feature public API?
3. Are the examples truly the same contract, or only visually similar today?
4. Would extracting now reduce meaningful duplication without hiding ownership?
5. Can the caller use an existing typed contract instead of reading raw payload fields?

Search names and behavior before editing:

```bash
rg "symbol_or_literal" src tests .trellis/spec
rg "kind|action|workspaceRevision|resourceId" src tests
```

## Local Patterns

- Shared cross-feature payloads belong in `src/shared/contracts` or an owning entity public API, not repeated local casts.
- Provider conditions stay in model adapters; resource MIME logic stays in processors; IndexedDB logic stays in repositories.
- Constants used by multiple features have one owner. Callers import them rather than copy numeric/string values.
- Extract an abstraction when repeated cases share ownership, invariants, and change cadence. Keep separate code when only surface syntax matches.

## Warning Signs

- copy/pasted helpers with slightly different failure behavior;
- multiple components parsing the same untyped event field;
- repeated constants whose values must change together;
- a generic utility that accepts many flags because its callers do not share one contract;
- a new helper created without searching the public module first.

## Follow Through

After selecting the owner, read its exact code-spec leaf from [Frontend specs](../../frontend/index.md). Validation belongs to that leaf; this guide does not replace it.
