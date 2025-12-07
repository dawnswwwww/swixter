#!/usr/bin/env node

/**
 * Sync APP_VERSION in src/constants/meta.ts with package.json version
 * This script is called during npm version's preversion hook
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');
const packageJsonPath = join(projectRoot, 'package.json');
const metaFilePath = join(projectRoot, 'src/constants/meta.ts');

try {
  // Read package.json to get the current version
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const version = packageJson.version;

  console.log(`[sync-version] Current version: ${version}`);

  // Read meta.ts file
  const metaContent = readFileSync(metaFilePath, 'utf-8');

  // Replace APP_VERSION value
  const updatedContent = metaContent.replace(
    /export const APP_VERSION = "[^"]*" as const;/,
    `export const APP_VERSION = "${version}" as const;`
  );

  // Write back to meta.ts
  writeFileSync(metaFilePath, updatedContent, 'utf-8');

  console.log(`[sync-version] ✓ Updated APP_VERSION to "${version}" in ${metaFilePath}`);
  process.exit(0);
} catch (error) {
  console.error('[sync-version] ✗ Error:', error.message);
  process.exit(1);
}
