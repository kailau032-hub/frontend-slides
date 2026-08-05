#!/usr/bin/env bash
#
# sync-plugin.sh — Regenerate the packaged plugin copy from the canonical skill.
#
# The repo root is the SINGLE SOURCE OF TRUTH for the Frontend Slides skill:
# SKILL.md, the support docs, scripts/, and the entire bold-template-pack/ live
# there and there only. The Claude Code plugin under
# plugins/frontend-slides/skills/frontend-slides/ is a generated mirror.
#
# Add or modify a template (or any skill file) at the repo root, then run this
# script to refresh the plugin copy so the standalone skill and the packaged
# plugin stay identical. Run it from anywhere; paths are resolved from the
# script's own location.
#
# Usage:
#   bash scripts/sync-plugin.sh          # sync root -> plugin
#   bash scripts/sync-plugin.sh --check  # verify they match; non-zero if drifted

set -euo pipefail

# Repo root = parent of this script's scripts/ directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_SKILL="$ROOT/plugins/frontend-slides/skills/frontend-slides"

# Canonical skill assets, relative to the repo root.
ASSETS=(
  "SKILL.md"
  "STYLE_PRESETS.md"
  "viewport-base.css"
  "html-template.md"
  "animation-patterns.md"
  "deck-editor.js"
  "bold-template-pack"
  "scripts"
)

CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
fi

if [[ ! -d "$PLUGIN_SKILL" ]]; then
  echo "error: plugin skill directory not found: $PLUGIN_SKILL" >&2
  exit 2
fi

drift=0
for asset in "${ASSETS[@]}"; do
  src="$ROOT/$asset"
  dst="$PLUGIN_SKILL/$asset"

  if [[ ! -e "$src" ]]; then
    echo "error: canonical asset missing at root: $asset" >&2
    exit 2
  fi

  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    if ! diff -rq "$src" "$dst" >/dev/null 2>&1; then
      echo "drift: $asset"
      drift=1
    fi
    continue
  fi

  # Refresh the destination from the canonical source.
  rm -rf "$dst"
  cp -R "$src" "$dst"
  echo "synced: $asset"
done

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if [[ "$drift" -eq 1 ]]; then
    echo "Plugin copy is OUT OF SYNC. Run: bash scripts/sync-plugin.sh" >&2
    exit 1
  fi
  echo "Plugin copy is in sync with the canonical root skill."
  exit 0
fi

echo "Done. Plugin copy regenerated from the canonical root skill."
