# Implementation Plan

## 1. Establish shared foundations

- [x] Update neutral surface, border, elevation, radius, type, control, and motion tokens.
- [x] Remove the unused network font import and make the platform system stack primary.
- [x] Add reduced-transparency and increased-contrast shared fallbacks.
- [x] Make global press/focus feedback consistent without breaking transformed controls.

## 2. Refine shared primitives

- [x] Refine translucent material helpers, form controls, icon buttons, menus, overlays, and mobile sheets.
- [x] Standardize selected, hover, active, disabled, destructive, and focus-visible states.
- [x] Keep desktop menus source-anchored and mobile action sheets bottom-anchored with symmetric exit motion.

## 3. Refine core workspace surfaces

- [x] Tune sidebar structure, resource/session rows, collapsed rail, and mobile drawer.
- [x] Tune workspace header/model selector and match the right tool rail to the left structural rail contract.
- [x] Animate the right workspace into fullscreen with a horizontal leftward reveal and reduced-motion fallback.
- [x] Tune chat message hierarchy, tool disclosures, task list, attachments, composer, and floating actions.
- [x] Tune mobile navigation and safe-area spacing.
- [x] Tune settings modal on desktop and settings sheet on mobile.
- [x] Inspect terminal, files, services, and preview chrome for shared-token regressions and apply only necessary local fixes.

## 4. Verify behavior and visuals

- [x] Run focused affected component tests.
- [x] Run `npm run check`.
- [x] Run `npm run test:e2e`.
- [x] Run `npm run test:visual`, inspect diffs, and update intentional baselines.
- [x] Inspect live desktop 1440x900 and mobile 390x844 states, including settings, menus, sidebar/drawer, chat content, composer, and navigation.
- [x] Verify reduced motion, reduced transparency, and increased contrast through computed styles or browser emulation where available.

## Review Gates

- No changed workflow semantics, accessible names, test selectors, or data contracts.
- No new production dependency.
- No text overlap, clipped controls, nested translucent surfaces, or illegible contrast in desktop/mobile captures.
- Visual snapshot updates correspond only to reviewed design changes.

## Rollback Points

- Shared foundation pass can be reverted independently before component refinements.
- Each surface group remains isolated by existing CSS module ownership.
- Snapshot updates occur last and can be reverted independently from source changes.
