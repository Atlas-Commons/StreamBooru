#!/usr/bin/env node
// Mirrors renderer/ into server/webapp/ (the web build served at /app).
//   node scripts/build-webapp.mjs           sync
//   node scripts/build-webapp.mjs --check   exit 1 if out of sync

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'renderer');
const DEST = path.join(root, 'server', 'webapp');
const checkOnly = process.argv.includes('--check');

function listFiles(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

const srcFiles = listFiles(SRC).sort();
if (srcFiles.length === 0) {
  console.error(`build-webapp: no files found in ${SRC}`);
  process.exit(1);
}

const destFiles = listFiles(DEST).sort();
const srcSet = new Set(srcFiles);

const stale = destFiles.filter((f) => !srcSet.has(f));
const changed = srcFiles.filter((f) => {
  const destPath = path.join(DEST, f);
  if (!fs.existsSync(destPath)) return true;
  return !fs.readFileSync(path.join(SRC, f)).equals(fs.readFileSync(destPath));
});

if (checkOnly) {
  if (stale.length === 0 && changed.length === 0) {
    console.log('build-webapp: server/webapp is in sync with renderer.');
    process.exit(0);
  }
  for (const f of changed) console.error(`  out of date: server/webapp/${f}`);
  for (const f of stale) console.error(`  stale file:  server/webapp/${f}`);
  console.error('build-webapp: server/webapp has drifted from renderer. Run "npm run webapp:build" and commit the result.');
  process.exit(1);
}

for (const f of stale) {
  fs.rmSync(path.join(DEST, f));
  console.log(`removed server/webapp/${f}`);
}
// Prune directories emptied by removals
for (const dir of listDirsDeepestFirst(DEST)) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}
for (const f of changed) {
  const destPath = path.join(DEST, f);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(path.join(SRC, f), destPath);
  console.log(`updated server/webapp/${f}`);
}
console.log(`build-webapp: ${changed.length} file(s) updated, ${stale.length} removed, ${srcFiles.length - changed.length} unchanged.`);

function listDirsDeepestFirst(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const full = path.join(dir, entry.name);
      out.push(...listDirsDeepestFirst(full), full);
    }
  }
  return out;
}
