#!/bin/bash
# Usage: scripts/bump-version.sh <patch|minor|major|X.Y.Z>
# Bumps packages/cli/Cargo.toml workspace version (single source of truth),
# syncs package.json files, commits, and creates a git tag.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

CURRENT_VERSION=$(grep -A5 '\[workspace.package\]' "$ROOT/packages/cli/Cargo.toml" | grep '^version' | head -1 | sed 's/.*"\(.*\)".*/\1/')

# Resolve the target version up front so the changelog gate can check its section
case "$1" in
  patch|minor|major)
    IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
    case "$1" in
      patch) PATCH=$((PATCH + 1)) ;;
      minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
      major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    esac
    TARGET_VERSION="$MAJOR.$MINOR.$PATCH"
    ;;
  *.*.*)
    TARGET_VERSION="$1"
    ;;
  *)
    echo "Usage: scripts/bump-version.sh <patch|minor|major|X.Y.Z>" >&2
    exit 1
    ;;
esac

# Changelog gate: the ## [TARGET_VERSION] section must exist and contain entries
SECTION=$(awk -v header="## [$TARGET_VERSION]" 'index($0, header) == 1 {flag=1; next} /^## \[/{flag=0} flag' "$ROOT/CHANGELOG.md")
if [ -z "$(echo "$SECTION" | tr -d '[:space:]')" ]; then
  echo "CHANGELOG.md has no entries under ## [$TARGET_VERSION]. Document the release changes before bumping." >&2
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
