# Interaction And Accessibility

## Applicability

Read this leaf when changing keyboard controls, async UI states, dialogs/overlays, document exit behavior, or the chat composer.

## Required Behavior

- Interactive controls use semantic buttons/links, accessible labels, and keyboard behavior.
- Modal/overlay UI restores focus, traps it where appropriate, supports Escape, and exposes `role="dialog"` with `aria-modal`.
- Async failures become visible state such as `role="alert"`. Loading regions use status semantics and disable unsafe actions.
- The root app mounts `BeforeUnloadGuard` for its lifetime. It calls `preventDefault()`, assigns `BeforeUnloadEvent.returnValue`, unregisters on unmount, and leaves wording to the browser.

`ChatComposer` follows the existing `900px` boundary:

- at `900px` or less, plain Enter preserves the textarea newline and the visible send button submits;
- above `900px`, plain Enter submits and Shift+Enter inserts a newline;
- IME composition never submits;
- a mounted component reacts when the viewport crosses the breakpoint;
- long input keeps `overflow-y: auto` while scrollbar chrome is hidden with `scrollbar-width: none` and a WebKit scrollbar rule.

## Forbidden Behavior

- Do not replace failed user actions with silent or unverified fallbacks.
- Do not use a custom in-app dialog as a replacement for document-level unload confirmation.
- Do not read responsive keyboard behavior only once at module load.
- Do not let IME Enter submit or remove the mobile send-button path.

## Required Validation

- Component tests cover desktop, mobile, resize, Shift+Enter, IME, send-button, alert, focus, and Escape behavior as applicable.
- Browser coverage asserts mobile scrollbar styling and any geometry/focus contract that jsdom cannot prove.
- Use [Test strategy](../quality/test-strategy.md).

## Related Contracts

- [Styling and motion](./styling-and-motion.md)
- [Disclosures and action menus](./disclosures-and-action-menus.md)
