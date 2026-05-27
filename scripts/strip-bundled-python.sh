#!/usr/bin/env bash
# Shrink bundled python tree before packaging into the .app
set -euo pipefail

ROOT="${1:?Usage: strip-bundled-python.sh <python-dir>}"

echo "Stripping ${ROOT}…"

find "$ROOT" -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
find "$ROOT" -type f -name '*.pyc' -delete 2>/dev/null || true
find "$ROOT" -type f -name '*.pyo' -delete 2>/dev/null || true

# Pytest cache only — DO NOT remove dirs named test/tests/testing globally.
# torch.testing, numpy.testing, transformers.testing_utils are runtime modules.
find "$ROOT" -type d -name '.pytest_cache' -prune -exec rm -rf {} + 2>/dev/null || true

# CPython stdlib test suites only (safe; saves tens of MB).
rm -rf "$ROOT/lib"/python*/test 2>/dev/null || true
rm -rf "$ROOT/lib"/python*/idle_test 2>/dev/null || true
rm -rf "$ROOT/lib"/python*/unittest/test 2>/dev/null || true

# Optional GUI / dev tooling not needed at runtime
rm -rf "$ROOT/share" 2>/dev/null || true
rm -rf "$ROOT/include" 2>/dev/null || true

# pip download cache inside the tree
find "$ROOT" -type d -name pip -path '*/site-packages/pip' -prune -exec rm -rf {} + 2>/dev/null || true

echo "Strip complete."
