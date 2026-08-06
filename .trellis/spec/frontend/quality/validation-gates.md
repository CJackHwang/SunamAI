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

Dependency refreshes must also prove the generated graph can be installed by default with `npm ci --dry-run`, that `npm ls` has no invalid/missing peer, and that `npm outdated --json` has no direct updates when the task requests current releases. If a direct test package requires a peer at runtime, declare that peer explicitly in `devDependencies`; do not rely on npm's incidental peer auto-installation. A temporary resolver flag may diagnose an unselected optional-peer conflict, but it must never become project `.npmrc` configuration or substitute for the default clean-install proof.

Current thresholds:

- statements/functions/lines at least 85%; branches at least 80%;
- initial JS at most 90 KiB gzip; total JS at most 470 KiB gzip;
- critical-path production `dist` at most 1.8 MiB;
- visual pixel difference at most 0.2%.

Total JS budget derivation (P1 起，见 `scripts/check-bundle.mjs`): 350 KiB 为现有应用 JS 基线；pi 引擎
（`@earendil-works/pi-agent-core` + `pi-ai`，`src/features/agent-core/pi/`）是默认关闭的可选通道，
经动态 import 懒加载，新增约 95 KiB gzip（piSession ~60 KiB + openai-completions SDK ~38 KiB），
不进初始 bundle（初始 bundle 仍受 90 KiB 门禁）。总预算 350 + 95 + 余量 ≈ 470 KiB；
若未来移除 pi 通道，总 JS 预算应回落到 350 KiB。

`dist` 预算只计「应用初始加载关键路径」上的资产：与 `/succinix` 一样，pi 懒加载 chunk
（`piSession-*.js`、`openai-completions-*.js`）按需加载、默认关闭，不计入 dist 门禁，
但其体积仍计入总 JS gzip 预算（pi 不免费，只是不在关键路径上）。

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
