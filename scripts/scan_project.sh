#!/bin/bash
# scan_project.sh — Reconnaissance helper for init-advanced skill
# Run: bash <skill-dir>/../../scripts/scan_project.sh

echo "=== Source files (top 50) ==="
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
  -o -name "*.py" -o -name "*.rs" -o -name "*.go" \) \
  ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" \
  2>/dev/null | head -50

echo ""
echo "=== Directory structure (depth 2) ==="
find . -maxdepth 2 -type d ! -path "*/node_modules/*" ! -path "*/.git/*" \
  ! -path "*/dist/*" ! -path "*/.pi/*" 2>/dev/null | sort | head -50

echo ""
echo "=== Existing .pi/rules ==="
if [ -d ".pi/rules" ]; then
  find .pi/rules -name "*.md" -exec grep -l "alwaysApply\|paths:" {} \; 2>/dev/null | head -20
else
  echo "(none)"
fi
