# Test Strategy

## Applicability

Read this leaf when deciding which test layer must prove a changed behavior.

## Required Behavior

- Unit tests prove pure logic, schemas, stores, engines, schedulers, tools, and adapters.
- Component tests prove rendered behavior and user interaction without duplicating E2E flows.
- E2E proves settings, session/container flows, Agent recovery, resources, compaction, cancellation, and child coordination.
- Visual tests cover supported desktop/mobile layouts and require baseline inspection.
- Runtime tests use a real WebContainer for processes, ports, materialization, snapshots, and cancellation evidence.
- Tests prove the failure path and ownership boundary, not only a happy path.

## Forbidden Behavior

- Do not use a component test to pretend a real WebContainer contract was exercised.
- Do not add a broad E2E scenario when a deterministic owner-level unit test proves the contract.
- Do not accept tautological tests that still pass if the feature under test is removed.

## Required Validation

- Map each acceptance criterion to the narrowest trustworthy test layer.
- Run focused tests during iteration and the final command selected by [Validation gates](./validation-gates.md).
- For visual requirements, inspect computed styles, geometry, or pixels.

## Related Contracts

- [Validation gates](./validation-gates.md)
- [Error and review policy](./error-and-review-policy.md)
