# Error And Review Policy

## Applicability

Read this leaf when adding a fallback, handling durable/security/completion failures, updating documentation, or performing final review.

## Required Behavior

Failures at durable, security, validation, or completion boundaries fail closed and remain visible. A fallback is allowed only when it preserves the contract and has one bounded owner, such as deterministic context compaction after its documented retry limit.

Final review confirms:

- dependency direction and feature boundaries;
- validation of external/persisted data;
- coherent cancellation, deletion, revision, and transaction boundaries;
- no Blob/Base64/secret in durable ledgers or errors;
- selective UI subscriptions and no-change short circuits;
- rendered visual evidence rather than token-name assumptions;
- failure-path coverage;
- README, architecture/design, acceptance, dependency, asset, and workflow docs match behavior;
- `git diff --check` and complete diff review pass.

## Forbidden Behavior

- silent in-memory persistence after IndexedDB failure;
- broad provider retries that hide unrelated 4xx errors;
- legacy database reads "just in case";
- clipboard/DOM branches that conceal a failed action;
- unbounded retries or duplicate fallback owners;
- catch blocks without a visible result, retry owner, cleanup rationale, or documented bounded best effort.

## Required Validation

- Tests cover the observable failure and recovery boundary.
- Review every critical/warning finding against actual data sources and design comments before prioritizing it.
- Use the final command selected by [Validation gates](./validation-gates.md).

## Related Contracts

- [Test strategy](./test-strategy.md)
- [Type safety](../foundation/type-safety.md)
- Evidence: `docs/refactor-acceptance.md` and `docs/dependency-advisories.md`.
