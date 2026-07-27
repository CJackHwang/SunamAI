# Quality Guidelines

## Required gates

After source changes, run:

```bash
npm run check
```

It runs strict TypeScript, Oxlint, architecture checks, core coverage, production build, and bundle limits.

Use `npm run check:all` for release-significant changes to Agent execution, context, persistence, resources, WebContainer runtime, subagents, E2E behavior, responsive/visual UI, dependencies, or workflow. Optimization-freeze claims require two consecutive full passes.

Current enforced thresholds:

- statements/functions/lines at least 85%; branches at least 80%
- initial JS at most 90 KiB gzip
- total JS at most 350 KiB gzip
- production `dist` at most 1.8 MiB
- visual pixel difference at most 0.2%

Production JavaScript is minified with the explicit `terser` dev dependency and four compression passes. Keep the configured-page/Agent/Workspace boundary lazy so an unconfigured visit does not load Agent Core or WebContainer; stronger minification supplements that boundary and must not replace it.

## Test placement

- Unit tests prove pure logic, schemas, stores, engines, schedulers, tools, and adapters.
- Component tests prove rendered behavior and user interaction without duplicating E2E flows.
- E2E proves settings, session/container flows, Agent recovery, resources, compaction, cancellation, and child coordination.
- Visual tests cover supported desktop/mobile layouts and require baseline inspection.
- Runtime tests use a real WebContainer for process, port, materialize, snapshot, and cancellation evidence.

## Error and fallback policy

Failures at durable, security, validation, or completion boundaries fail closed and remain visible. A fallback is allowed only when it preserves the contract and has a bounded owner, for example deterministic context compaction after the documented retry limit or a readable syntax-highlight fallback.

Do not add:

- silent in-memory persistence after IndexedDB failure
- broad provider retries that hide unrelated 4xx errors
- legacy database reads “just in case”
- clipboard/DOM compatibility branches that conceal an actual failed action
- unbounded retry loops or duplicate fallback layers around an existing circuit breaker
- catch blocks with no visible result, retry owner, cleanup rationale, or documented best-effort boundary

## Review checklist

- Dependency direction and feature boundaries still pass.
- External/persisted data is validated.
- Cancellation, deletion, revision, and transaction boundaries remain coherent.
- No Blob/Base64/secret enters durable ledgers or error text.
- UI subscriptions are selective and no-change writes short-circuit.
- Visual requirements are verified from computed styles, browser geometry, or
  inspected pixel baselines. A semantically named token alone is not evidence
  that the rendered color, spacing, or contrast matches the requirement.
- Tests prove the failure path, not only the happy path.
- README, architecture/design, acceptance, dependency, asset, and workflow Markdown matches the actual result.
- `git diff --check` and staged diff checks pass.

Evidence: `package.json`, `vitest.config.ts`, `scripts/check-bundle.mjs`, `docs/refactor-acceptance.md`, and `docs/dependency-advisories.md`.
