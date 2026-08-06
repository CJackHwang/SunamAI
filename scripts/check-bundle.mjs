import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { sep, join } from 'node:path';

const distDir = join(process.cwd(), 'dist');
const assetsDir = join(distDir, 'assets');
const entries = readdirSync(assetsDir).filter((file) => /^index-.*\.js$/.test(file));

if (entries.length !== 1) {
  throw new Error(`Expected exactly one initial index bundle, found ${entries.length}.`);
}

const asset = join(assetsDir, entries[0]);
const gzipBytes = gzipSync(readFileSync(asset)).byteLength;
const limitKb = Number(process.env.SUNAM_INITIAL_GZIP_LIMIT_KB ?? 90);
const gzipKb = gzipBytes / 1024;

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

// Succinix host 运行时资产（dist/succinix/**）是注入 WebContainer 的第三方基础设施，
// 不进应用加载关键路径，从 dist 体积预算中排除（见 scripts/sync-succinix-assets.mjs）。
const files = listFiles(distDir).filter((file) => !file.split(sep).includes('succinix'));
const jsFiles = files.filter((file) => file.endsWith('.js'));
const totalJsGzipKb = jsFiles.reduce((total, file) => total + gzipSync(readFileSync(file)).byteLength, 0) / 1024;
const distMiB = files.reduce((total, file) => total + statSync(file).size, 0) / (1024 * 1024);
// P1 pi 引擎（@earendil-works/pi-agent-core + pi-ai）是默认关闭的可选通道，经动态 import
// 懒加载：piSession ~53KiB + openai-completions SDK ~38KiB gzip，不进初始 bundle
// （初始 bundle 仍受 90KiB 门禁约束）。总 JS 预算相应上调以容纳该可选功能。
const totalJsLimitKb = Number(process.env.SUNAM_TOTAL_GZIP_LIMIT_KB ?? 470);
const distLimitMiB = Number(process.env.SUNAM_DIST_LIMIT_MIB ?? 1.8);

console.log(`Initial bundle: ${entries[0]} (${gzipKb.toFixed(2)} KiB gzip; limit ${limitKb} KiB)`);
console.log(`Total JavaScript: ${totalJsGzipKb.toFixed(2)} KiB gzip; limit ${totalJsLimitKb} KiB`);
console.log(`Production dist: ${distMiB.toFixed(2)} MiB; limit ${distLimitMiB} MiB (excludes deferred /succinix runtime assets)`);

if (gzipKb > limitKb) {
  throw new Error(`Initial bundle exceeds the ${limitKb} KiB gzip performance budget.`);
}

if (totalJsGzipKb > totalJsLimitKb) {
  throw new Error(`Total JavaScript exceeds the ${totalJsLimitKb} KiB gzip performance budget.`);
}

if (distMiB > distLimitMiB) {
  throw new Error(`Production dist exceeds the ${distLimitMiB} MiB performance budget.`);
}
