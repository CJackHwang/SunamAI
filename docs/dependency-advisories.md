# 依赖 Advisory 策略

生产依赖必须通过：

```bash
npm run check:audit
# 等价于 npm audit --omit=dev --audit-level=high
```

验收标准是 production dependency 的 high/critical advisory 为零。该检查属于 `npm run check:all`；无法访问 npm registry 时必须记为未执行，不能使用旧结果代替。

## Development-only PWA / Workbox 例外

截至 2026-07-26，lockfile 使用 Vite `8.1.5`、`vite-plugin-pwa` `1.3.0`、`workbox-build` `7.4.1` 和 `workbox-window` `7.4.1`。联网执行 `npm audit --json` 的结果为 8 个 high、0 critical，全部位于 development-only PWA/Workbox 构建链：

- 直接入口：`vite-plugin-pwa` → `workbox-build` → `@trickfilm400/rollup-plugin-off-main-thread` → `ejs` / `jake` / `filelist` / `minimatch` / `brace-expansion`。
- 当前可识别的底层 advisory：[`GHSA-mh99-v99m-4gvg`](https://github.com/advisories/GHSA-mh99-v99m-4gvg)，`brace-expansion` 可因无界展开导致进程内存耗尽。
- npm 给出的自动修复是降级到 `vite-plugin-pwa@1.2.0`。该版本 peer dependency 只支持 Vite 3–7；当前 `1.3.0` 才声明支持 Vite 8，因此不能用不兼容降级换取表面上的零 advisory。

同日 `npm run check:audit` 已在两次连续 `npm run check:all` 中实际通过，结果均为 `found 0 vulnerabilities`。这证明 production dependency 的 high/critical 为零；完整开发依赖审计的 8 个 high 仍按本节例外跟踪。

例外范围仅限构建期依赖，并满足以下条件：

- 生产依赖审计仍必须为零；
- 不通过降级到不兼容 Vite 8 的旧 PWA 插件来制造表面安全；
- lockfile 固定已审查版本，更新后重新运行完整 build、PWA 和 audit；
- 一旦上游发布兼容修复，立即移除例外并升级；
- 每次发布在 PR/发布记录中写明 audit 日期、命令、advisory ID/链接、受影响包和处置决定。

复查流程：

1. 运行 `npm audit --omit=dev --audit-level=high`，确认 production 为零。
2. 运行完整 `npm audit`，记录仅 development 链中的 advisory。
3. 检查 Vite 8-compatible `vite-plugin-pwa` / Workbox 最新版本和 changelog。
4. 若存在修复版本，升级并执行 `npm run check:all`；若不存在，更新本文件的日期和可审计证据。

此例外不适用于运行时依赖、浏览器发送的代码或任何 production high/critical advisory。
