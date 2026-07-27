import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

const files = listFiles(distDir);
const jsFiles = files.filter((file) => file.endsWith('.js'));
const totalJsGzipKb = jsFiles.reduce((total, file) => total + gzipSync(readFileSync(file)).byteLength, 0) / 1024;
const distMiB = files.reduce((total, file) => total + statSync(file).size, 0) / (1024 * 1024);
const totalJsLimitKb = Number(process.env.SUNAM_TOTAL_GZIP_LIMIT_KB ?? 350);
const distLimitMiB = Number(process.env.SUNAM_DIST_LIMIT_MIB ?? 1.8);

console.log(`Initial bundle: ${entries[0]} (${gzipKb.toFixed(2)} KiB gzip; limit ${limitKb} KiB)`);
console.log(`Total JavaScript: ${totalJsGzipKb.toFixed(2)} KiB gzip; limit ${totalJsLimitKb} KiB`);
console.log(`Production dist: ${distMiB.toFixed(2)} MiB; limit ${distLimitMiB} MiB`);

if (gzipKb > limitKb) {
  throw new Error(`Initial bundle exceeds the ${limitKb} KiB gzip performance budget.`);
}

if (totalJsGzipKb > totalJsLimitKb) {
  throw new Error(`Total JavaScript exceeds the ${totalJsLimitKb} KiB gzip performance budget.`);
}

if (distMiB > distLimitMiB) {
  throw new Error(`Production dist exceeds the ${distLimitMiB} MiB performance budget.`);
}
