#!/bin/bash
# Usage: scripts/bump-version.sh <patch|minor|major|X.Y.Z>
# Bumps packages/cli/Cargo.toml workspace version (single source of truth),
# syncs package.json files, commits, and creates a git tag.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Changelog gate: [Unreleased] must contain entries for the release being cut
UNRELEASED=$(awk '/^## \[Unreleased\]/{flag=1; next} /^## \[/{flag=0} flag' "$ROOT/CHANGELOG.md")
if [ -z "$(echo "$UNRELEASED" | tr -d '[:space:]')" ]; then
  echo "CHANGELOG.md [Unreleased] section is empty. Document the release changes before bumping." >&2
  exit 1
fi

cd "$ROOT/packages/cli"

if ! command -v cargo-set-version >/dev/null 2>&1 && ! cargo set-version --help >/dev/null 2>&1; then
  echo "cargo-edit is required: cargo install cargo-edit" >&2
  exit 1
fi

cargo set-version --workspace "$1"
NEW_VERSION=$(grep -A5 '\[workspace.package\]' Cargo.toml | grep '^version' | head -1 | sed 's/.*"\(.*\)".*/\1/')
cd "$ROOT"
node scripts/sync-versions.js
git add packages/cli/Cargo.toml packages/cli/Cargo.lock package.json packages/*/package.json
git commit -m "chore: release v${NEW_VERSION}"
git tag "v${NEW_VERSION}"
echo "Tagged v${NEW_VERSION}. Run: git push --follow-tags"
