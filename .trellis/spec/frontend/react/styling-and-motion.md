# Styling And Motion

## Applicability

Read this leaf when changing CSS ownership, surface geometry, chat colors/spacing, animation roles, or presence timing.

## Required Behavior

- Use colocated plain CSS and shared design tokens. Global fonts live in `src/app/fonts.css`; reference only shipped WOFF2 weights 400/500/600/700 and italic 400.
- Nested rounded surfaces use `inner radius = outer radius - padding`, using the smaller/dominant padding axis when axes differ.
- Chat and nested tool surfaces use symmetric padding: message 16px, thinking 10px, tool disclosure 8px, arguments/results 12px. They use background, spacing, and concentric radii rather than borders.
- User message bubbles use `--color-gray-700` (`#3a3a3a`), not black or near-black.

```css
.chat-message { padding: 16px; border: 0; }
.thinking-process { padding: 10px; }
.chat-tool { padding: 8px; }
.chat-tool-arguments, .chat-tool-result-content { padding: 12px; }
```

Use motion tokens by role:

- color, border, opacity, hover: `--motion-fast` with `ease`;
- small transforms/direct manipulation: `--motion-fast` or `--motion-base` with `--motion-snappy`/`--motion-spring`;
- panels, intrinsic size, grid rows, sidebars, sheets: `--motion-slow` with `--motion-sheet`;
- exits: `--motion-exit`, normally shorter than entrance.

When `usePresence(value, exitDuration)` retains a component, its duration is at least the longest responsive exit animation. A 240ms mobile sheet must not use a 160ms desktop-menu lifetime.

## Forbidden Behavior

- Do not substitute a semantically named token without checking the rendered color.
- Do not animate `font-size` for selection; keep typography stable and use color, weight, or a small transform.
- Do not use unrelated large inner radii or asymmetric chat padding that breaks visual hierarchy.
- Do not unmount a responsive exit before its CSS animation completes.

## Required Validation

- Verify computed styles, browser geometry, or inspected pixel baselines; token names alone are not evidence.
- Visual changes use applicable component and Playwright visual coverage, including reduced motion.
- Use [Test strategy](../quality/test-strategy.md) and [Validation gates](../quality/validation-gates.md).

## Related Contracts

- [Disclosures and action menus](./disclosures-and-action-menus.md)
- [Interaction and accessibility](./interaction-and-accessibility.md)
