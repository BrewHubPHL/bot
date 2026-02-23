#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

function shouldSkip(file) {
  return file.includes('node_modules') || file.includes('.next') || file.includes('public') || file.includes('dist') || file.includes('.netlify') || file.includes('netlify');
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (shouldSkip(full)) continue;
    if (ent.isDirectory()) {
      results.push(...await listFiles(full));
    } else if (ent.isFile() && /\.mjs$|\.js$|\.cjs$/.test(ent.name)) {
      results.push(full);
    }
  }
  return results;
}

async function tryImport(file) {
  try {
    await import(pathToFileUrl(file).href);
    return { file, ok: true };
  } catch (e) {
    return { file, ok: false, error: e.stack || String(e) };
  }
}

function pathToFileUrl(p) {
  return pathToFileURL(p);
}

(async function main(){
  console.log('Scanning project JS files and attempting imports (skipping node_modules/.next/public)...');
  const files = await listFiles(ROOT);
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    process.stdout.write(`Importing ${rel} ... `);
    const res = await tryImport(f);
    if (res.ok) {
      console.log('OK');
    } else {
      console.log('ERROR');
      console.error(res.error);
      process.exit(1);
    }
  }
  console.log('All imports succeeded.');
})();
