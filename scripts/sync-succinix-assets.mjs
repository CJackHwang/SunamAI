#!/usr/bin/env node
// 把 Succinix host 运行时资产同步到 SunamAI public/succinix/，供 host 注入 WebContainer 使用。
// 资产（host.js / lifo-core.js / pyodide/）是第三方运行时产物，gitignored，不随 SunamAI 源码提交。
// 本地 dev / 真实浏览器实测前先运行本脚本：
//   node scripts/sync-succinix-assets.mjs
//
// V1 H1-3：来源优先级 —— 本地 WebUnix 检出 > npm 包 @succinix/engine > 显式报错。
//  1. 本地 WebUnix（默认 ~/Desktop/MyProject/WebUnix/public，可用 SUCCINIX_SOURCE_DIR 覆盖）：
//     权威构建产物（含 pyodide/），本地开发用它保证与源码一致。
//  2. npm 包 @succinix/engine（packages/engine/assets/host.js + lifo-core.js）：
//     CI / 无 WebUnix 检出的克隆通过 `npm ci` 装上包后从这里取 host.js + lifo-core.js；
//     该包不含 pyodide（python 运行时只在本地 WebUnix 构建注入，CI runtime 测试不依赖 python）。
//  3. 两者都不可用：显式 exit 1（此前静默跳过会让 CI 构建出无 host.js 的应用，runtime 门禁形同虚设）。
// 该脚本已挂进 package.json 的 predev/prebuild 与 CI quality.yml（见 N2）。
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const explicitSource = process.env.SUCCINIX_SOURCE_DIR;
// 本地 WebUnix（现为 Succinix 仓库）默认检出路径：~/Desktop/MyProject/Succinix/public。
// 旧默认 ~/Desktop/MyProject/WebUnix/public 已随仓库改名失效（存在性检查会回落 npm 包，
// 但那包不含最新 host.js 归属字段 —— 本地开发必须优先本地构建产物）。
const sourceRoot = resolve(explicitSource ?? `${process.env.HOME}/Desktop/MyProject/Succinix/public`);
const targetRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../public/succinix');

// 本地 WebUnix 来源：权威构建产物（host.js / lifo-core.js / pyodide）。
// 显式指定 SUCCINIX_SOURCE_DIR 时缺源是致命错误（开发者明确指向了来源）。
if (existsSync(sourceRoot)) {
  const assets = ['host.js', 'lifo-core.js', 'pyodide'];
  for (const name of assets) {
    const source = resolve(sourceRoot, name);
    if (!existsSync(source)) {
      console.error(`[sync-succinix-assets] missing source asset: ${source}`);
      process.exit(1);
    }
  }
  mkdirSync(targetRoot, { recursive: true });
  for (const name of assets) {
    cpSync(resolve(sourceRoot, name), resolve(targetRoot, name), { recursive: true });
    console.log(`[sync-succinix-assets] synced ${name} -> public/succinix/${name}`);
  }
  process.exit(0);
}

if (explicitSource) {
  console.error(`[sync-succinix-assets] SUCCINIX_SOURCE_DIR points to a missing directory: ${sourceRoot}`);
  process.exit(1);
}

// 本地 WebUnix 缺失 → 回落 npm 包 @succinix/engine（CI 经 npm ci 装上，取 ./host.js ./lifo-core.js）。
let npmEngineRoot = null;
try {
  npmEngineRoot = resolve(dirname(require.resolve('@succinix/engine/package.json')));
} catch {
  npmEngineRoot = null;
}
if (npmEngineRoot) {
  const assets = ['host.js', 'lifo-core.js'];
  const missing = assets.filter((name) => !existsSync(join(npmEngineRoot, 'assets', name)));
  if (missing.length > 0) {
    console.error(`[sync-succinix-assets] @succinix/engine is installed but missing assets: ${missing.join(', ')}`);
    process.exit(1);
  }
  mkdirSync(targetRoot, { recursive: true });
  for (const name of assets) {
    cpSync(join(npmEngineRoot, 'assets', name), resolve(targetRoot, name));
    console.log(`[sync-succinix-assets] synced ${name} (from @succinix/engine) -> public/succinix/${name}`);
  }
  if (!existsSync(resolve(targetRoot, 'pyodide'))) {
    console.warn(`[sync-succinix-assets] @succinix/engine 不含 pyodide/ —— python 运行时资产未注入（test:runtime 不依赖 python；本地 dev 请用 WebUnix 来源）。`);
  }
  process.exit(0);
}

// 两者都不可用：显式失败（不再静默跳过 —— CI 构建必须带真实 host.js，否则 runtime 门禁失去意义）。
console.error(
  '[sync-succinix-assets] FAILED: no Succinix host assets found.\n' +
  '  - Local WebUnix build not found at: ' + sourceRoot + '\n' +
  '  - npm package @succinix/engine is not installed.\n' +
  '  Fix: run `npm install` (to pull @succinix/engine), or clone WebUnix and build it locally,\n' +
  '  or set SUCCINIX_SOURCE_DIR to a directory containing host.js / lifo-core.js / pyodide.'
);
process.exit(1);
