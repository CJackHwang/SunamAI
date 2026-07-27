# Validation Gates

## Applicability

Read this leaf before reporting completion for source, interaction, visual, runtime, dependency, or release-significant changes.

## Required Behavior

After source changes run:

```bash
npm run check
```

It runs strict TypeScript, Oxlint, architecture checks, core coverage, production build, and bundle limits.

Use `npm run check:all` for release-significant changes to Agent execution, context, persistence, resources, WebContainer runtime, subagents, E2E behavior, responsive/visual UI, dependencies, or workflow. Optimization-freeze claims require two consecutive full passes and inspection of new visual baselines.

Current thresholds:

- statements/functions/lines at least 85%; branches at least 80%;
- initial JS at most 90 KiB gzip; total JS at most 350 KiB gzip;
- production `dist` at most 1.8 MiB;
- visual pixel difference at most 0.2%.

Production JS uses the explicit `terser` dev dependency and four compression passes. Preserve the configured-page/Agent/Workspace lazy boundary; minification supplements it and never replaces it.

Documentation-only reorganizations run focused structure/link checks plus `git diff --check`; they do not run product suites unless executable files change.

## Forbidden Behavior

- Do not claim a gate passed from an older revision or a partial command.
- Do not replace a required full gate with unrelated focused success.
- Do not run expensive gates repeatedly after edits that cannot affect their result; run focused checks during iteration and the required gate on final state.

## Required Validation

- Record the exact final command and whether it passed, failed, or could not run.
- Inspect changed visual baselines instead of accepting a runner exit code alone.
- Run `git diff --check` and review the complete final diff.

## Related Contracts

- [Test strategy](./test-strategy.md)
- [Error and review policy](./error-and-review-policy.md)
- Evidence: `package.json`, `vitest.config.ts`, `scripts/check-bundle.mjs`, and `docs/refactor-acceptance.md`.
