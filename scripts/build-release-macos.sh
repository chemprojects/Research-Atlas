#!/usr/bin/env bash
# Full macOS release build with pre-bundled Python (no pip on first launch).
#
# Usage:
#   bash scripts/build-release-macos.sh              # native arch
#   bash scripts/build-release-macos.sh arm64        # Apple Silicon .app (from Intel or M1)
#   bash scripts/build-release-macos.sh x86_64       # Intel .app
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARCH_ARG="${1:-native}"
HOST_ARCH="$(uname -m)"

case "$ARCH_ARG" in
  native)
    case "$HOST_ARCH" in
      arm64)  TAURI_TARGET="aarch64-apple-darwin" ;;
      x86_64) TAURI_TARGET="x86_64-apple-darwin" ;;
      *) echo "Unsupported host: $HOST_ARCH" >&2; exit 1 ;;
    esac
    ;;
  arm64|aarch64|apple-silicon|m1)
    TAURI_TARGET="aarch64-apple-darwin"
  ;;
  x86_64|intel|x64)
    TAURI_TARGET="x86_64-apple-darwin"
  ;;
  -h|--help|help)
    head -12 "$0" | tail -10
    exit 0
    ;;
  *)
    echo "Unknown arch: $ARCH_ARG" >&2
    exit 1
    ;;
esac

CROSS=false
if [[ "$HOST_ARCH" == "x86_64" && "$TAURI_TARGET" == "aarch64-apple-darwin" ]]; then
  CROSS=true
fi

echo "=== Host ${HOST_ARCH} → Tauri target ${TAURI_TARGET} (cross=${CROSS}) ==="

echo "=== 1/3 Bundled Python ==="
bash "$ROOT/scripts/build-bundled-python.sh" "$ARCH_ARG"

echo "=== 2/3 Frontend ==="
npm run build --prefix frontend

if [[ "$CROSS" == true ]]; then
  echo "=== Rust target for cross-compile ==="
  rustup target add aarch64-apple-darwin 2>/dev/null || true
fi

echo "=== 3/3 Tauri (${TAURI_TARGET}) ==="
cd src-tauri
cargo tauri build --target "$TAURI_TARGET"

echo ""
echo "Done. DMG:"
echo "  src-tauri/target/${TAURI_TARGET}/release/bundle/macos/"
if [[ "$TAURI_TARGET" == "aarch64-apple-darwin" ]]; then
  echo ""
  echo "Copy the .dmg to your M1 Mac, install, and test there."
fi
