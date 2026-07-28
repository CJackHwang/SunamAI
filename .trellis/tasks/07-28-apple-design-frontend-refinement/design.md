# Technical Design

## Approach

Implement the refinement as a CSS-first design-system pass with narrowly scoped component changes only where state hooks or class names are needed. Preserve the existing React composition and data flow.

## Boundaries

- `src/app/base.css`: semantic color, type, radius, elevation, focus, and global press tokens.
- `src/shared/styles/motion.css`: shared timing/easing and accessibility fallbacks.
- `src/shared/styles/effects.css`, `controls.css`, `formControls.css`, and `menus.css`: material, control-state, form, and menu contracts.
- Core surface CSS under `src/widgets`, `src/features/chat/ui`, and `src/features/terminal-session`: consume shared tokens and refine layout/material hierarchy.
- React/TSX changes are allowed only for missing state semantics, accessibility attributes, or stable class hooks. No domain/state contract changes.

The production dependency direction remains `shared -> entities -> features -> widgets -> pages -> app`.

## Visual System

### Color and material

- Retain a neutral light canvas with distinct base, structural, raised, and floating surfaces.
- Use semi-transparent backgrounds plus moderate blur/saturation only on genuinely floating chrome.
- Use subtle border highlights and small, hierarchy-specific shadows rather than applying shadow to every panel.
- Introduce solid fallbacks under reduced transparency and stronger borders under increased contrast.

### Typography

- Use the native platform system stack first.
- Keep letter spacing at zero, build hierarchy with weight and size, and use compact line heights for controls versus more generous line heights for message content.
- Avoid viewport-width font scaling in compact UI.

### Shape and density

- Keep circular icon actions circular.
- Use modest radii for rows, menus, and internal disclosure surfaces; reserve larger radii for the composer, modal, and mobile sheets where the existing design system already treats them as primary surfaces.
- Normalize icon-button and row dimensions so dynamic content cannot shift layout.

### Motion

- Use short feedback timing for press/hover and approximately 300-400ms spring-like easing for spatial panel movement.
- Keep menu motion restrained and source-anchored; keep sheet motion bottom-anchored.
- Do not animate layout-affecting properties per frame where transforms/opacity suffice.
- Reduced motion replaces translations/scales with short fades or immediate state changes.

## Compatibility

- Existing selectors used by Playwright tests must remain stable.
- Existing accessible names and roles remain unchanged.
- No local-storage, IndexedDB, API, runtime, or workspace schema changes.
- No migration is required.

## Verification Strategy

- Run focused component tests for shared menus, settings, chat composer/messages, mobile navigation, sidebar history, and affected resource/tool surfaces.
- Run `npm run check` for type, lint, architecture, coverage, build, and bundle gates.
- Run `npm run test:e2e` and `npm run test:visual`; update snapshots only after desktop/mobile visual review.
- Use live browser inspection at 1440x900 and 390x844 to check composition, clipping, materials, and interaction states.

## Risks and Rollback

- Broad token changes can create unexpected contrast or spacing regressions. Apply shared tokens first, then inspect every visual fixture before component-specific fixes.
- Global button transforms can conflict with component transforms. Scope or compose active feedback for controls that already animate transforms.
- Backdrop blur can reduce contrast or performance. Restrict it to floating chrome and retain solid fallbacks.
- Snapshot churn may hide defects. Review rendered diffs, not only snapshot test exit codes.
- Rollback is CSS-file scoped because no data or dependency migration is introduced.
