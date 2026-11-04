#!/usr/bin/env bash
# check-kiro-dir.sh
#
# Fails CI if:
#   1. The /.kiro directory is missing from the repository root, OR
#   2. Any .gitignore in the repository explicitly ignores .kiro (or .kiro/).
#
# Usage: bash scripts/check-kiro-dir.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIRO_DIR="$REPO_ROOT/.kiro"
EXIT_CODE=0

# ── 1. Directory presence check ──────────────────────────────────────────────
if [[ ! -d "$KIRO_DIR" ]]; then
  echo "::error::'.kiro' directory is missing from the repository root." >&2
  echo "  The .kiro/ directory must be committed (steering, specs, hooks, agents)." >&2
  EXIT_CODE=1
fi

# ── 2. .gitignore exclusion check ────────────────────────────────────────────
# Search every .gitignore in the repo tree for a line that would ignore .kiro.
# Patterns matched (intentionally broad):
#   .kiro          .kiro/         /.kiro         /.kiro/
#   **/.kiro       **/.kiro/
IGNORE_PATTERN='^\s*/?(\*\*/)?\.kiro/?(\s|$)'

mapfile -t GITIGNORE_FILES < <(find "$REPO_ROOT" -name ".gitignore" \
  -not -path "*/node_modules/*" \
  -not -path "*/.next/*" \
  -not -path "*/dist/*")

for file in "${GITIGNORE_FILES[@]}"; do
  if grep -Eq "$IGNORE_PATTERN" "$file"; then
    # Collect the offending lines for a helpful error.
    OFFENDING=$(grep -En "$IGNORE_PATTERN" "$file" || true)
    echo "::error file=$file::'.kiro' is ignored by $file" >&2
    echo "  Offending line(s):" >&2
    while IFS= read -r line; do
      echo "    $line" >&2
    done <<< "$OFFENDING"
    EXIT_CODE=1
  fi
done

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✓ .kiro/ is present and not gitignored."
fi

exit $EXIT_CODE
