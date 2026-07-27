# Quality Spec Index

## Scope

Use this router to select the final evidence required for a production or documentation change.

## Routes

| Question | Read |
| --- | --- |
| Which command is required and when is the full gate mandatory? | [Validation gates](./validation-gates.md) |
| Which test layer should prove the behavior? | [Test strategy](./test-strategy.md) |
| How must failures, fallbacks, documentation, and final review be handled? | [Error and review policy](./error-and-review-policy.md) |

## Validation Entry Point

The selected leaf is the validation entry point. Documentation-only reorganizations use link/structure checks and `git diff --check` unless executable files change.
