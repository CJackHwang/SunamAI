# Apple design frontend refinement

## Goal

Refine SunamAI's existing frontend so the core workspace feels calmer, more immediate, and more spatially coherent according to the supplied Apple Design guidance, while preserving the current product structure and behavior. The result should improve visual hierarchy, material depth, typography, press feedback, reversible motion, and accessibility on desktop and mobile without turning the work into a redesign.

## Background

- The supplied `apple-design` reference prioritizes immediate response, spatial consistency, restrained spring-like motion, translucent hierarchy, system typography, and reduced-motion/transparency/contrast alternatives.
- The current UI already has shared color, radius, elevation, and motion tokens in `src/app/base.css:3` and `src/shared/styles/motion.css:1`, but elevation tokens are all disabled and material treatments are inconsistent.
- The current desktop workspace uses a 260px sidebar, floating chat composer, top model selector, and right tool rail. Mobile replaces the rail with a five-item bottom navigation and presents settings/actions as bottom sheets.
- Browser baselines at 1440x900 and 390x844 confirm that the information architecture is clear; the main opportunity is refinement of hierarchy, density, materials, typography, and feedback rather than structural change.
- Existing visual coverage includes configuration, mixed session history, subagent menus, and resource/subagent workspace states in `tests/visual/app.visual.spec.ts`.

## Requirements

### R1. Shared visual foundation

- Consolidate the neutral palette, surface hierarchy, borders, elevation, radii, typography, and motion values into defensible shared tokens.
- Use the platform system font stack as the primary UI typography and remove any unused network font import.
- Keep the current light, neutral SunamAI identity; do not introduce a new brand palette.
- Use size-appropriate line height, weight, and tracking so compact controls remain readable and headings remain visually distinct.

### R2. Material and spatial hierarchy

- Give floating chrome such as the model header, chat composer controls, menus, modal/sheets, and mobile navigation a restrained translucent material with clear separation from scrolling content.
- Treat the collapsed left and right navigation rails as matching opaque structural regions with shared width, separator, control geometry, spacing, and interaction-state tokens.
- Keep structural regions such as the sidebar visually quieter and more opaque than floating controls.
- Avoid stacked translucent layers and excessive shadow; material weight must reflect surface size and hierarchy.
- Preserve spatially symmetric enter/exit paths and source-aware transform origins for menus, sheets, and reversible panels.

### R3. Immediate and coherent interaction feedback

- Preserve or improve pointer-down feedback for buttons without causing layout shift or overriding component transforms.
- Standardize hover, active, disabled, focus-visible, selected, and running/error states across the core workspace.
- Keep non-gesture animations interruptible in practice by avoiding input lockout during transitions and by using short, consistent motion tokens.
- Reserve overshoot-like motion for physical sheet/panel movement; ordinary menus and fades should remain critically damped and restrained.

### R4. Core surface refinement

- Refine the desktop and mobile presentation of the sidebar, workspace header, chat message list, chat composer, task/tool disclosures, right tool rail, mobile navigation, settings modal/sheet, and shared menus.
- Improve grouping, alignment, target sizing, text contrast, and density without changing navigation destinations or workflow semantics.
- Preserve Lucide icon usage, current labels, and the existing desktop/mobile breakpoint behavior.
- Expand the right workspace horizontally from the half-screen divider into fullscreen with a smooth leftward reveal; retain a reduced-motion alternative.

### R5. Accessibility and responsive resilience

- Retain visible keyboard focus and semantic controls.
- Provide `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast: more` fallbacks for affected materials and transitions.
- Ensure controls and text do not overlap or clip at 1440x900 and 390x844, including mobile safe-area insets.
- Preserve existing touch target behavior and prevent hover-only affordances from hiding essential mobile actions.

### R6. Behavioral compatibility

- Do not change agent execution, persistence, WebContainer runtime, API settings semantics, resource/session behavior, or data contracts.
- Do not add a motion library or other production dependency for this refinement.
- Update visual baselines only after reviewing the rendered diffs as intended design changes.

## Acceptance Criteria

- [x] AC1: At 1440x900, the primary workspace shows matching opaque structural navigation rails and restrained floating materials for the workspace header, composer, menus, and modal without nested-glass legibility loss.
- [x] AC2: At 390x844, the header, composer, bottom navigation, sidebar, settings sheet, and action sheet fit without overlap or clipped text and respect safe-area spacing.
- [x] AC3: Buttons provide immediate press feedback; hover, selected, disabled, focus-visible, success, warning/error, and running states remain visually distinguishable.
- [x] AC4: Menus, sheets, modal, disclosures, sidebar, and model selector enter/exit along symmetric paths; the right workspace enters fullscreen with a leftward horizontal reveal and no input lockout.
- [x] AC5: Reduced-motion mode removes large translations/overshoot while retaining short opacity/state feedback; reduced-transparency and increased-contrast modes produce solid, legible surfaces.
- [x] AC6: System UI typography is used without a network font import, and compact labels/messages remain readable in Chinese and English fixture content.
- [x] AC7: Existing component, E2E, runtime, architecture, and data behavior remain unchanged; no production dependency is added.
- [x] AC8: `npm run check` passes, targeted E2E/visual tests pass, and all changed visual snapshots have been inspected at desktop and mobile sizes.

## Out of Scope

- New information architecture, routes, features, labels, or workflow steps.
- Dark mode or a user-selectable theme system.
- New drag, swipe, momentum, rubber-band, sound, or haptic interactions.
- A new animation/runtime dependency.
- Changes to agent, persistence, resource, terminal, service, or WebContainer contracts.
- Rebranding, new illustration assets, or logo replacement.

## Technical Notes

- Prefer shared tokens and shared style modules over one-off component values.
- Existing CSS-driven transitions are appropriate for non-gesture interactions; the supplied guidance's spring-library recommendation does not justify a new dependency where no direct manipulation is being added.
- Existing visual fixtures cover both core breakpoints and should remain the main regression surface.
