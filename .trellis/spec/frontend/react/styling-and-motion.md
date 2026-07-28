# Styling And Motion

## Applicability

Read this leaf when changing CSS ownership, surface geometry, chat colors/spacing, animation roles, or presence timing.

## Required Behavior

- Use colocated plain CSS and shared design tokens. Global fonts live in `src/app/fonts.css`; reference only shipped WOFF2 weights 400/500/600/700 and italic 400.
- Interactive surface radii use the shared `12px / 16px / 28px` scale: `--radius-small` for compact controls and nested records, `--radius-medium` for form controls and list rows, and `--radius-large` for popovers, modal surfaces, sheets, and major message surfaces. Popover items account for the owner's padding (`calc(var(--radius-large) - 8px)`) so hover and danger fills remain concentric. Brand artwork, loading-skeleton shapes, inline-code chips, focus outlines, circles, and pills may retain geometry-specific radii; other interactive surfaces do not introduce smaller hard-coded values.
- Nested rounded surfaces use `inner radius = outer radius - padding`, using the smaller/dominant padding axis when axes differ.
- Chat and nested tool surfaces use symmetric padding: message 16px, thinking 10px, tool disclosure 8px, arguments/results 12px. They use background, spacing, and concentric radii rather than borders.
- User message bubbles use `--color-gray-700` (`#3a3a3a`), not black or near-black.

```css
:root {
  --radius-small: 12px;
  --radius-medium: 16px;
  --radius-large: 28px;
}

.context-menu { border-radius: var(--radius-large); }
.context-item { border-radius: calc(var(--radius-large) - 8px); }
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

### Floating material and press contracts

- Floating chrome uses the shared `--material-thin`, `--material-regular`, `--material-thick`, `--material-blur`, and `--material-blur-thick` tokens from `src/app/base.css`. Structural regions such as the sidebar remain opaque.
- Opposing collapsed navigation rails are one structural family: both remain opaque and share `--nav-rail-width`, control size/radius, icon gap, separator weight, and hover/selected tokens. Brand marks may keep their own geometry, but ordinary rail controls do not fork these values.
- Every translucent surface has a colocated `prefers-reduced-transparency: reduce` solid fallback. Increased contrast uses an opaque surface plus a `--color-text` border; reduced motion replaces spatial entrance/exit with short opacity feedback.
- Global press feedback uses the independent `scale` property, not `transform`, so it composes with component-owned translate/rotate transforms.
- Inline editors nested in a selectable row keep focus visible on the owning row with an inset, concentric ring; suppress the nested input's duplicate rectangular outline.
- Shared form-control minimum heights are defaults, not density overrides. Pointer-dense desktop rows may explicitly use 36px controls; at `900px` or less, restore a minimum 44px touch target. Familiar commit/cancel actions may use consistent `Check`/`X` icons across breakpoints only when the buttons retain translated `aria-label` and `title` text.
- Fullscreen right-workspace entrance keeps the right edge fixed and transitions the sibling flex bases from `50/50` to `0/100`; do not scale, snapshot-crossfade, or clip already-reflowed terminal contents. Hide the model header while entering fullscreen, keep it visible for `collapsed` to `half`, and restore it late only when returning from `full`. Reduced motion shortens the transition through the global motion fallback.
- When a test asserts material strength, assert the full computed value. A token change from `blur(16px)` to `blur(22px) saturate(1.6)` must update the owning computed-style assertion and reviewed visual baselines together.

```css
.floating-control {
  background: var(--material-regular);
  backdrop-filter: blur(var(--material-blur)) saturate(160%);
}

button:active:not(:disabled) { scale: 0.97; }

.dense-inline-action { height: 36px; min-height: 36px; }

@media (max-width: 900px) {
  .dense-inline-action { width: 44px; height: 44px; min-height: 44px; }
}

@media (prefers-reduced-transparency: reduce) {
  .floating-control {
    background: var(--color-surface);
    backdrop-filter: none;
  }
}
```

## Forbidden Behavior

- Do not substitute a semantically named token without checking the rendered color.
- Do not animate `font-size` for selection; keep typography stable and use color, weight, or a small transform.
- Do not copy a numeric blur value into a new floating surface; consume the shared blur token for its material weight so changes remain coordinated.
- Do not use unrelated large inner radii or asymmetric chat padding that breaks visual hierarchy.
- Do not unmount a responsive exit before its CSS animation completes.

## Required Validation

- Verify computed styles, browser geometry, or inspected pixel baselines; token names alone are not evidence.
- Visual changes use applicable component and Playwright visual coverage, including reduced motion, reduced transparency, and increased contrast where material behavior changes.
- Use [Test strategy](../quality/test-strategy.md) and [Validation gates](../quality/validation-gates.md).

## Related Contracts

- [Disclosures and action menus](./disclosures-and-action-menus.md)
- [Interaction and accessibility](./interaction-and-accessibility.md)
