#!/usr/bin/env node

/**
 * Extract changelog content for a specific version from CHANGELOG.md
 * Used by GitHub Actions to create release notes
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');
const changelogPath = join(projectRoot, 'CHANGELOG.md');

// Get version from command line argument or environment variable
const version = process.argv[2] || process.env.npm_package_version;

if (!version) {
  console.error('[extract-changelog] Error: No version specified');
  console.error('Usage: node extract-changelog.js <version>');
  console.error('   or: npm_package_version=0.0.4 node extract-changelog.js');
  process.exit(1);
}

try {
  // Read CHANGELOG.md
  const changelog = readFileSync(changelogPath, 'utf-8');

  // Remove leading 'v' if present
  const cleanVersion = version.replace(/^v/, '');

  // Create regex to match the version section
  // Matches from ## [version] to the next ## [version] or end of file
  // Use [\s\S] instead of [^] and make it non-greedy
  const versionRegex = new RegExp(
    `## \\[${cleanVersion.replace(/\./g, '\\.')}\\][\\s\\S]*?(?=\\n## \\[|$)`,
    ''
  );

  const match = changelog.match(versionRegex);

  if (!match) {
    console.error(`[extract-changelog] Error: Version ${cleanVersion} not found in CHANGELOG.md`);
    process.exit(1);
  }

  // Extract the content and clean it up
  let content = match[0];

  // Remove the version header line (## [X.Y.Z] - YYYY-MM-DD) and following blank lines
  const lines = content.split('\n');
  // Skip first line (version header) and any empty lines after it
  let startIndex = 1;
  while (startIndex < lines.length && lines[startIndex].trim() === '') {
    startIndex++;
  }
  content = lines.slice(startIndex).join('\n').trim();

  // If content is empty, something went wrong
  if (!content) {
    console.error(`[extract-changelog] Error: No content found for version ${cleanVersion}`);
    process.exit(1);
  }

  // Output the extracted content
  console.log(content);
  process.exit(0);
} catch (error) {
  console.error('[extract-changelog] Error:', error.message);
  process.exit(1);
}
