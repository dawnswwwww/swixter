#!/usr/bin/env node

/**
 * Sync version across all workspace packages and CLI meta.ts.
 * Reads root package.json version, writes it to every workspace package.json
 * and updates APP_VERSION in packages/cli/src/constants/meta.ts.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

const rootPkg = readJson(resolve(root, 'package.json'));
const version = rootPkg.version;
console.log(`[sync-versions] Version: ${version}`);

// Sync each workspace package.json
const packages = ['packages/cli', 'packages/website', 'packages/docs'];

for (const pkg of packages) {
  const pkgPath = resolve(root, pkg, 'package.json');
  if (!existsSync(pkgPath)) {
    console.log(`[sync-versions] - Skipping ${pkg} (no package.json)`);
    continue;
  }
  const pkgData = readJson(pkgPath);
  if (pkgData.version === version) {
    console.log(`[sync-versions] - ${pkg} already ${version}`);
    continue;
  }
  pkgData.version = version;
  writeJson(pkgPath, pkgData);
  console.log(`[sync-versions] ✓ ${pkg} → ${version}`);
}

// Update APP_VERSION in meta.ts
const metaPath = resolve(root, 'packages/cli/src/constants/meta.ts');
if (existsSync(metaPath)) {
  const metaContent = readFileSync(metaPath, 'utf-8');
  const updated = metaContent.replace(
    /export const APP_VERSION = "[^"]*" as const;/,
    `export const APP_VERSION = "${version}" as const;`
  );
  if (updated !== metaContent) {
    writeFileSync(metaPath, updated, 'utf-8');
    console.log(`[sync-versions] ✓ APP_VERSION → "${version}" in meta.ts`);
  } else {
    console.log('[sync-versions] - APP_VERSION already up to date');
  }
}

console.log('[sync-versions] Done.');
