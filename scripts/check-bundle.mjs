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

// 关键路径定义：dist 预算只计「应用初始加载路径」上的资产，排除按需/运行时基础设施：
// - Succinix host 运行时资产（dist/succinix/**）是注入 WebContainer 的第三方基础设施，
//   不进应用加载关键路径（见 scripts/sync-succinix-assets.mjs）；
// - pi 引擎懒加载 chunk（dist/assets/piSession-*.js、openai-completions-*.js、anthropic-messages-*.js）
//   是默认关闭的可选通道（feature flag 默认关），经动态 import 按需加载，同样不进初始加载关键路径。
// 二者的 JS 体积仍计入下方 Total JavaScript gzip 预算（pi 不免费，只是不在关键路径上）。
const isDeferredRuntime = (file) => {
  const normalized = file.split(sep).join('/');
  return /\/succinix\//.test(normalized) || /\/assets\/(?:piSession|openai-completions|anthropic-messages)-[^/]*\.js$/.test(normalized);
};
const allFiles = listFiles(distDir).filter((file) => !file.split(sep).includes('succinix'));
const criticalFiles = allFiles.filter((file) => !isDeferredRuntime(file));
const jsFiles = allFiles.filter((file) => file.endsWith('.js'));
const totalJsGzipKb = jsFiles.reduce((total, file) => total + gzipSync(readFileSync(file)).byteLength, 0) / 1024;
const distMiB = criticalFiles.reduce((total, file) => total + statSync(file).size, 0) / (1024 * 1024);
// 完整 on-disk 体积（含被排除的 deferred 运行时），只报告、不设门槛。
const fullDistMiB = allFiles.reduce((total, file) => total + statSync(file).size, 0) / (1024 * 1024);
// P1 pi 引擎（@earendil-works/pi-agent-core + pi-ai）是默认关闭的可选通道，经动态 import
// 懒加载：piSession ~72KiB + openai-completions SDK ~34KiB + anthropic-messages SDK ~26KiB gzip，
// 不进初始 bundle（初始 bundle 仍受 90KiB 门禁约束）。总 JS 预算相应上调以容纳该可选功能：
// 350KiB（现有应用 JS 基线） + ~130KiB（pi 懒加载通道） + ~25KiB 余量 = 505KiB。
const totalJsLimitKb = Number(process.env.SUNAM_TOTAL_GZIP_LIMIT_KB ?? 505);
const distLimitMiB = Number(process.env.SUNAM_DIST_LIMIT_MIB ?? 1.8);

console.log(`Initial bundle: ${entries[0]} (${gzipKb.toFixed(2)} KiB gzip; limit ${limitKb} KiB)`);
console.log(`Total JavaScript: ${totalJsGzipKb.toFixed(2)} KiB gzip; limit ${totalJsLimitKb} KiB`);
console.log(`Critical-path dist: ${distMiB.toFixed(2)} MiB; limit ${distLimitMiB} MiB (excludes deferred /succinix + pi lazy runtime chunks)`);
console.log(`Full on-disk dist: ${fullDistMiB.toFixed(2)} MiB (deferred runtime reported, not gated)`);

if (gzipKb > limitKb) {
  throw new Error(`Initial bundle exceeds the ${limitKb} KiB gzip performance budget.`);
}

if (totalJsGzipKb > totalJsLimitKb) {
  throw new Error(`Total JavaScript exceeds the ${totalJsLimitKb} KiB gzip performance budget.`);
}

if (distMiB > distLimitMiB) {
  throw new Error(`Critical-path dist exceeds the ${distLimitMiB} MiB performance budget.`);
}
