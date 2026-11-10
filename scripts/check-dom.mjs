import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (full.endsWith('.js')) files.push(full);
  }
})(path.join(root, 'client/src'));

const used = new Map();
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:getElementById|\$)\(\s*['"]([\w-]+)['"]\s*\)/g)) {
    used.set(match[1], path.relative(root, file));
  }
}

const missing = [...used].filter(([id]) => !ids.has(id));
console.log(`DOM ids: ${ids.size} · referenced: ${used.size}`);
for (const [id, file] of missing) console.log(`MISSING #${id} -> ${file}`);
if (missing.length === 0) console.log('All referenced DOM ids exist.');
const unused = [...ids].filter((id) => !used.has(id));
if (unused.length) console.log(`Not referenced from JS: ${unused.join(', ')}`);
process.exitCode = missing.length ? 1 : 0;
