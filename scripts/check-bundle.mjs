import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const assetsDir = join(process.cwd(), 'dist', 'assets');
const entries = readdirSync(assetsDir).filter((file) => /^index-.*\.js$/.test(file));

if (entries.length !== 1) {
  throw new Error(`Expected exactly one initial index bundle, found ${entries.length}.`);
}

const asset = join(assetsDir, entries[0]);
const gzipBytes = gzipSync(readFileSync(asset)).byteLength;
const limitKb = Number(process.env.SUNAM_INITIAL_GZIP_LIMIT_KB ?? 180);
const gzipKb = gzipBytes / 1024;

console.log(`Initial bundle: ${entries[0]} (${gzipKb.toFixed(2)} KiB gzip; limit ${limitKb} KiB)`);

if (gzipKb > limitKb) {
  throw new Error(`Initial bundle exceeds the ${limitKb} KiB gzip performance budget.`);
}
