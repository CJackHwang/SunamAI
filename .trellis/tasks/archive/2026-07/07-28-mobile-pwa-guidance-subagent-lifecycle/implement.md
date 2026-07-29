# Implementation Plan

1. Correct shared mobile material accessibility fallback and terminal focus
   behavior; add focused UI/runtime assertions.
2. Add root Engine FIFO guidance injection, expose it through `useAgentV2`, and
   make the shared composer action switch between empty-input Stop and
   text-present Send while a run is active.
3. Tighten child tool policy and terminal-state handling; add `ask_parent`,
   preserve the user-facing per-child stop path, and prove parent coordination
   plus isolated cancellation behavior.
4. Add transient compaction status projection, thinking sheen, prose-plus-tool
   rendering coverage, and bounded tool disclosure details.
5. Run focused component/unit tests, inspect mobile visual/computed styles,
   then run `npm run check:all`, `git diff --check`, and final diff review.

## Validation

- `tests/component/ChatComposer.test.tsx`
- `tests/component/ChatMessageList.test.tsx`
- `tests/unit/agentEngine.test.ts`
- `tests/unit/agentContext.test.ts`
- `tests/unit/subagentCoordinator.test.ts`
- Mobile browser/visual assertions for material and terminal focus
- `npm run check:all`
