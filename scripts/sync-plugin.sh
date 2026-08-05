#!/usr/bin/env bash
#
# sync-plugin.sh — ensure the packaged plugin mirrors the canonical root skill.
#
# The repo root is the SINGLE SOURCE OF TRUTH. The Claude Code plugin under
# plugins/frontend-slides/skills/frontend-slides/ contains only SYMLINKS that
# point back to the root files — so editing a file (or a template) at the root
# is immediately reflected in the plugin, and nothing is duplicated.
#
# This script (re)creates those symlinks if any are missing or wrong. Run it
# after adding a NEW top-level skill asset (add it to ASSETS below too).
#
# Usage:
#   bash scripts/sync-plugin.sh          # create/fix the plugin symlinks
#   bash scripts/sync-plugin.sh --check  # verify they exist and resolve

set -euo pipefail

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
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

[[ -d "$PLUGIN_SKILL" ]] || { echo "error: plugin skill directory not found: $PLUGIN_SKILL" >&2; exit 2; }

drift=0
for asset in "${ASSETS[@]}"; do
  target="../../../../$asset"          # from the plugin skill dir back to the repo root
  link="$PLUGIN_SKILL/$asset"

  [[ -e "$ROOT/$asset" ]] || { echo "error: canonical asset missing at root: $asset" >&2; exit 2; }

  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    if [[ "$(readlink "$link" 2>/dev/null)" != "$target" ]] || [[ ! -e "$link" ]]; then
      echo "drift: $asset (expected symlink -> $target)"
      drift=1
    fi
  else
    if [[ "$(readlink "$link" 2>/dev/null)" != "$target" ]]; then
      rm -rf "$link"
      ln -s "$target" "$link"
      echo "linked: $asset -> $target"
    fi
  fi
done

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if [[ "$drift" -eq 1 ]]; then
    echo "Plugin symlinks are OUT OF SYNC. Run: bash scripts/sync-plugin.sh" >&2
    exit 1
  fi
  echo "Plugin symlinks are in place and resolve to the canonical root skill."
  exit 0
fi

echo "Done. The plugin points to the canonical root skill via symlinks (no duplication)."
