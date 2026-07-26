import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const sourceRoot = path.resolve('src');
const layers = new Set(['shared', 'entities', 'features', 'widgets', 'pages', 'app']);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

function moduleTarget(source, specifier) {
  if (specifier.startsWith('@/')) return path.join(sourceRoot, specifier.slice(2));
  if (specifier.startsWith('.')) return path.resolve(path.dirname(source), specifier);
  return null;
}

function ownership(file) {
  const relative = path.relative(sourceRoot, file);
  const [layer, feature] = relative.split(path.sep);
  return { layer, feature, relative };
}

function violation(source, target) {
  const from = ownership(source);
  const to = ownership(target);
  if (!layers.has(from.layer) || !layers.has(to.layer)) return null;
  if (from.layer === 'shared' && to.layer !== 'shared') return `shared cannot depend on ${to.layer}`;
  if (from.layer === 'entities' && !['shared', 'entities'].includes(to.layer)) return `entities cannot depend on ${to.layer}`;
  if (from.layer === 'features') {
    if (['widgets', 'pages', 'app'].includes(to.layer)) return `features cannot depend on ${to.layer}`;
    if (to.layer === 'features' && from.feature !== to.feature) return `feature ${from.feature} cannot import internals from feature ${to.feature}`;
  }
  if (from.layer === 'widgets' && ['pages', 'app'].includes(to.layer)) return `widgets cannot depend on ${to.layer}`;
  if (from.layer === 'pages' && to.layer === 'app') return 'pages cannot depend on app';
  return null;
}

const importPattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const issues = [];
for (const file of await sourceFiles(sourceRoot)) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    const target = moduleTarget(file, specifier);
    if (!target) continue;
    const reason = violation(file, target);
    if (!reason) continue;
    const line = content.slice(0, match.index).split('\n').length;
    issues.push(`${path.relative(process.cwd(), file)}:${line} ${reason}: ${specifier}`);
  }
}

if (issues.length) {
  console.error(`Architecture boundary check failed:\n${issues.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Architecture boundaries passed.');
}
