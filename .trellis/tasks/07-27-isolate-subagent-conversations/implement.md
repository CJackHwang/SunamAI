# Implementation Plan

1. Add repository/event-store child deletion and terminal-pruning operations,
   including atomicity, scope, idempotence, and parent/resource preservation
   tests.
2. Extend the coordinator and Agent hook with first-spawn cleanup, awaited
   single-child stop/delete, per-Run streaming state, root-only status helpers,
   lightweight session-child presence loading and lazy child transcript loading.
3. Lift the configured Agent controller to the page composition boundary and
   add transient root/child view selection shared by Sidebar and Workspace.
4. Replace the flat history renderer with an accessible animated session tree,
   immutable child rows, status projection, and delete-only child menu.
5. Add the read-only child transcript footer and root/child message projection;
   preserve parent input and scroll state across child viewing.
6. Extract the intrinsic disclosure animation, apply it to tool calls,
   RunBoard checkpoint and child sections, and refine borderless/radius styles.
7. Change user bubbles to visibly dark `--color-gray-700`, add zh-CN/en-US/ja-JP strings, and
   update architecture, runtime, acceptance, and Trellis specs.
8. Add component and browser coverage for hierarchy, isolation, controls,
   cleanup, deletion, animation, reduced motion, responsive layout, and visual
   snapshots.
9. Run focused tests during implementation, then `npm run check:all`,
   `git diff --check`, and inspect desktop/mobile screenshots before completion.
10. Replace the three-role child creation API with `explore | task`, give task
    children the full non-delegating toolset, allow three mixed-role children
    to execute concurrently, and retain legacy persisted-role compatibility.
11. Teach the root prompt/tool schema to choose read-only exploration versus a
    complete task and to spawn independent children before waiting.
12. Portal child actions into the shared menu layer, preserve disclosure state
    when returning from a child, and replace History with Pin for pinned rows.
13. Extend schema/tool/coordinator/component/E2E/visual coverage, synchronize
    public docs/specs, and rerun the complete gate.
14. Exempt every depth-one child role from mandatory completion verification
    while preserving root gates and optional child verification evidence.
15. Make multi-child waiting deliver one unreported terminal notification per
    call without mutating sibling state, and keep the structured completion
    report contract visible to the root prompt/tool description.
16. Render an optional child-owned RunBoard in the read-only child footer,
    prove plan isolation in tests, and remove the negative verification badge
    and locale strings.
17. Replace the reduced/shared child budget with an independent copy of the
    root Run budget, add a regression for persisted values and exhausted-root
    isolation, then synchronize budget documentation and rerun the gates.

## Rollback points

- Persistence methods land with tests before callers are enabled.
- Navigation remains transient; reverting UI does not require data migration.
- Run-level deletion never touches resources, root events, or workspace state.
