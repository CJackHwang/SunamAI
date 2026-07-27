# Disclosures And Action Menus

## Applicability

Read this leaf when changing expandable rows, intrinsic-size animation, sidebar child disclosure, or any resource/action menu.

## Required Behavior

Keep native `<details>/<summary>` semantics. When intrinsic dimensions jump, the owner may measure closed/open `getBoundingClientRect()` states and animate explicit width/height with the Web Animations API.

- Closed DOM starts without `open`; keyboard activation of `summary` works.
- Opening exposes `open` immediately. Closing retains content only until exit completes.
- Use non-linear easing and clip overflow during size transition.
- Reduced motion or missing `Element.animate` changes state immediately.
- If the nearest scroll owner was already at bottom, use direct `scrollTop = scrollHeight` correction during the user-triggered animation; wheel/touch input stops correction.
- Cancel animations, frames, and temporary listeners on rapid reversal and unmount.

Controls available while collapsed live outside the hidden body:

```tsx
<div className="session-group">
  <details><summary>Session</summary><div>Children</div></details>
  <button aria-label="Session actions" />
</div>
```

Render disclosure only when expandable content exists. Preload lightweight child summaries, not transcripts, to decide whether the row has a disclosure. Rows reserve the same trailing action slot. Returning from a selected child to root preserves the open list on first activation; later root activations toggle normally.

All resource/action menus use `shared/ui/ActionMenu`. It owns the `document.body` portal, overlay, 240ms presence, viewport clamping, menu semantics, danger state, separators, and close-after-action behavior. Callers provide typed items and business callbacks.

- Desktop menus are viewport-clamped popovers at trigger coordinates.
- At `900px` or less every menu is a full-width bottom sheet with shared safe-area padding and sheet motion.
- Pinned history/resource rows replace the leading resource glyph with Pin; they do not add a second icon.
- Status and optional chevron share one `sidebar-session-trailing` positioning owner. Rename mode omits that group and the outer action button so the input receives remaining width.

```tsx
<ActionMenu
  menu={menu}
  ariaLabel="File actions"
  onClose={closeMenu}
  items={(target) => [
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => rename(target) },
    { id: 'delete', label: 'Delete', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => remove(target) },
  ]}
/>
```

## Forbidden Behavior

- Do not replace semantic disclosure with a clickable `div`.
- Do not place always-available controls inside a closed details body.
- Do not animate guessed `max-height` or start smooth scrolling on every frame.
- Do not render speculative chevrons on empty rows.
- Do not create feature-specific portals, mobile menu positioning, or child-menu exceptions.

## Required Validation

- Component tests cover default/collapsed state, action availability, toggle, rapid reversal, reduced motion, portal payload retention, roles, disabled items, and Escape/overlay/action closing.
- Browser tests prove intrinsic animation starts/settles, desktop menus stay in viewport, and mobile sheets are bottom-aligned/full-width for single- and multi-action callers.

## Related Contracts

- [Styling and motion](./styling-and-motion.md)
- [Interaction and accessibility](./interaction-and-accessibility.md)
- References: `src/shared/ui/ActionMenu.tsx`, `src/features/terminal-session/ServicePreviewOverlay.tsx`, `src/widgets/settings/SettingsModal.tsx`, and `tests/component`.
