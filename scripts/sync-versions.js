#!/usr/bin/env node

/**
 * Sync version from Cargo workspace (single source of truth) to all package.json files.
 * Reads packages/cli/Cargo.toml [workspace.package] version, writes it to root
 * package.json and every workspace package.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

const cargoToml = readFileSync(resolve(root, 'packages/cli/Cargo.toml'), 'utf-8');
const match = cargoToml.match(/\[workspace\.package\][^\[]*?version\s*=\s*"([^"]+)"/s);
if (!match) {
  console.error('[sync-versions] Could not find [workspace.package] version in packages/cli/Cargo.toml');
  process.exit(1);
}
const version = match[1];
console.log(`[sync-versions] Version (from Cargo.toml): ${version}`);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

const packages = ['package.json', 'packages/cli/package.json', 'packages/website/package.json', 'packages/docs/package.json'];

for (const pkg of packages) {
  const pkgPath = resolve(root, pkg);
  if (!existsSync(pkgPath)) {
    console.log(`[sync-versions] - Skipping ${pkg} (missing)`);
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

console.log('[sync-versions] Done.');
