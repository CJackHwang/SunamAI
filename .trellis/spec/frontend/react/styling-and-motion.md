# Styling And Motion

## Applicability

Read this leaf when changing CSS ownership, surface geometry, chat colors/spacing, animation roles, or presence timing.

## Required Behavior

- Use colocated plain CSS and shared design tokens. Global fonts live in `src/app/fonts.css`; reference only shipped WOFF2 weights 400/500/600/700 and italic 400.
- Interactive surface radii use the shared `12px / 16px / 28px` scale: `--radius-small` for compact controls and nested records, `--radius-medium` for form controls and list rows, and `--radius-large` for popovers, modal surfaces, sheets, and major message surfaces. Popover items account for the owner's padding (`calc(var(--radius-large) - 8px)`) so hover and danger fills remain concentric. Brand artwork, loading-skeleton shapes, inline-code chips, focus outlines, circles, and pills may retain geometry-specific radii; other interactive surfaces do not introduce smaller hard-coded values.
- Nested rounded surfaces use `inner radius = outer radius - padding`, using the smaller/dominant padding axis when axes differ.
- Chat and nested tool surfaces use symmetric padding: message 16px, thinking 10px, tool disclosure 8px, arguments/results 12px. They use background, spacing, and concentric radii rather than borders.
- User message bubbles use `--color-gray-700` (`#3a3a3a`), not black or near-black.
- The idle thinking label uses a restrained horizontal white text sheen without changing layout. One `3s` cycle contains the original `1.8s` non-repeating sweep across a `250%` background from one symmetric off-text position (`100%`) to the other (`0%`), followed by a `1.2s` off-text dwell; this lowers loop frequency to `0.6x` without changing highlight travel speed. Remember that percentage `background-position` offsets are calculated from `container size - background image size`; they are not literal percentages of the text width. Set the resting background position explicitly, keep the white band fully offscreen at both ends, and use only an invisible end-of-cycle discrete reset so the `100%` frame exactly matches the next `0%` frame. Do not repeat the gradient tile or encode multiple sweep ranges. Reduced motion and forced colors remove the sheen and retain readable solid text.
- Thinking content, tool arguments, and tool results share one `96px` detail-viewport limit. Tool argument/result panes each occupy the full disclosure width and scroll independently; the outer body does not apply a second competing height clip.

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

JavaScript-driven Web Animations consume these CSS tokens through the shared `shared/ui/motion` primitives. Do not hard-code a second duration/easing table in a feature hook. Reusable React layout boundaries use `useLayoutSizeAnimation`; disclosure and FLIP owners reuse the same spatial preset and reduced-motion check.

Shared intrinsic-size animation enforces a maximum average width speed of `1px/ms` by extending the spatial preset duration for large horizontal changes. Small changes retain the normal role duration and easing; feature components do not add their own velocity rules.

One visible spatial transition has one size owner. When a parent layout boundary animates a compound update, such as reasoning collapsing while a tool row appears, nested components commit their final intrinsic layout without running another width/height animation. Nested opacity or transform feedback may coexist, but parent and child must not both hold `width` or `height` with `fill: both` for the same transition.

Animated chat rows sit inside one observed transcript-content boundary. The existing scroll owner responds to its geometry changes according to follow mode; `useLayoutSizeAnimation` remains a pure geometry owner and message components do not implement scroll correction.

Keyed vertical lists that reorder after pin/unpin use shared FLIP motion rather than feature-specific CSS positions. Owners provide stable `data-reorder-key` IDs and an order signature. Suppress the first measurement, animate the moved row and displaced siblings, cancel/replace in-flight animations from their current visual rectangles, clean up on unmount, and bypass spatial motion under reduced motion.

When `usePresence(value, exitDuration)` retains a component, its duration is at least the longest responsive exit animation. A 240ms mobile sheet must not use a 160ms desktop-menu lifetime.

### Floating material and press contracts

- Floating chrome uses the shared `--material-thin`, `--material-regular`, `--material-thick`, `--material-blur`, and `--material-blur-thick` tokens from `src/app/base.css`. Structural regions such as the sidebar remain opaque.
- Opposing collapsed navigation rails are one structural family: both remain opaque and share `--nav-rail-width`, control size/radius, icon gap, separator weight, and hover/selected tokens. Brand marks may keep their own geometry, but ordinary rail controls do not fork these values.
- Every translucent surface has a colocated `prefers-reduced-transparency: reduce` solid fallback. Only `forced-colors: active` uses the opaque surface plus `--color-text` border fallback; ordinary mobile/PWA rendering and generic increased-contrast preferences retain the standard and `-webkit-` backdrop filters and soft token border. Reduced motion replaces spatial entrance/exit with short opacity feedback.
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
- Visual changes use applicable component and Playwright visual coverage, including reduced motion, reduced transparency, ordinary mobile material, and forced-colors where material behavior changes.
- Use [Test strategy](../quality/test-strategy.md) and [Validation gates](../quality/validation-gates.md).

## Related Contracts

- [Disclosures and action menus](./disclosures-and-action-menus.md)
- [Interaction and accessibility](./interaction-and-accessibility.md)
