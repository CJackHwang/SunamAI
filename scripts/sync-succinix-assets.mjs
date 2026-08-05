#!/usr/bin/env node
// 把 WebUnix 的 Succinix 构建产物同步到 SunamAI public/succinix/，供 host 注入 WebContainer 使用。
// 产物（host.js / lifo-core.js / pyodide/）由 WebUnix 构建生成，属第三方运行时资产，gitignored，
// 不随 SunamAI 源码提交——本地 dev / 真实浏览器实测前先运行本脚本：
//   node scripts/sync-succinix-assets.mjs
// 来源目录可用环境变量 SUCCINIX_SOURCE_DIR 覆盖（默认 ~/Desktop/MyProject/WebUnix/public）。
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(process.env.SUCCINIX_SOURCE_DIR ?? `${process.env.HOME}/Desktop/MyProject/WebUnix/public`);
const targetRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../public/succinix');
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
