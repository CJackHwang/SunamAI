# Implementation Plan

## 1. Provider and Agent reasoning path

- [x] Update `src/shared/api/sse.ts` nullable wire validation while preserving strict type rejection.
- [x] Update the plain assistant completion branch in `src/features/agent-core/engine.ts` to preserve `reasoning_content`.
- [x] Extend `tests/unit/llm.test.ts` with nullable content/reasoning SSE fixtures.
- [x] Extend `tests/unit/agentEngine.test.ts` to cover final plain-message reasoning preservation.

## 2. Stable chat scrolling

- [x] Refactor `src/features/chat/hooks/useChatAutoScroll.ts` to separate instant automatic following from explicit smooth navigation.
- [x] Keep follow intent in a ref updated synchronously by user/programmatic scroll events.
- [x] Remove bottom-padding transition from `src/features/chat/ui/Chat.css` so reserved composer height does not animate scrollHeight independently.
- [x] Add hook/component coverage for bottom following, user scroll-away, and explicit smooth return.
- [x] Recheck `Workspace.tsx` history-page compensation and composer height dependencies without changing pagination ownership.

## 3. Compact reasoning and collapsible tools

- [x] Reduce ThinkingProcess spacing and content max-height in `Chat.css`.
- [x] Convert ordinary tool cards in `ChatMessage.tsx` to default-closed semantic details/summary markup.
- [x] Add completed-state i18n strings to zh-CN, en-US, and ja-JP.
- [x] Style disclosure summary/body, chevron, focus and overflow states.
- [x] Match the tool container to `var(--color-bg)` and animate intrinsic disclosure width/height with nonlinear easing, bottom anchoring, interruption, and reduced-motion fallback.
- [x] Audit global motion roles, align menu presence with responsive exit durations, add model-menu exit motion, remove font-size layout animation, and normalize tool-message padding.
- [x] Extend `ChatMessageList` component tests for default closed state, expand interaction, status text, and `ask_user` behavior.

## 4. Verification

- [x] Run targeted Vitest suites for LLM, AgentEngine, chat message list, composer/auto-scroll.
- [x] Run `npm run check`.
- [x] Run `npm run check:all` because the change affects Agent provider parsing and responsive/visual chat behavior.
- [x] Inspect git diff, `git diff --check`, and any updated visual baselines before completion.

## Verification Evidence

- Targeted Vitest: 4 files, 37 tests passed for provider reasoning, AgentEngine, auto-scroll, and tool disclosure behavior.
- `npm run check`: 36 files, 175 tests passed; coverage 91.24% statements, 83.05% branches, 90.40% functions, 94.97% lines.
- `npm run check:all`: two consecutive final-state passes; E2E 7/7, visual 4/4, runtime 3/3, production audit 0 vulnerabilities.
- Bundle gates: initial 84.94 KiB gzip, total JavaScript 314.09 KiB gzip, dist 1.34 MiB.
- Motion regression evidence: context-menu presence remains mounted for the full 240ms sheet exit; Chromium confirms the model selector uses `model-selector-out`; updated desktop/mobile snapshots show symmetric tool-message padding.
- Updated desktop/mobile workspace visual baselines were manually compared before acceptance and revalidated without snapshot-update mode.

## Risky Files and Rollback Points

- `src/shared/api/sse.ts`: provider boundary; rollback independently if validation becomes too permissive.
- `src/features/chat/hooks/useChatAutoScroll.ts`: interaction behavior; preserve public return shape for `Workspace.tsx`.
- `src/features/chat/ui/Chat.css`: avoid global layout side effects; changes stay scoped to chat classes.
- Visual snapshots must not be accepted blindly; inspect whether differences are limited to compact reasoning/tool disclosures.
