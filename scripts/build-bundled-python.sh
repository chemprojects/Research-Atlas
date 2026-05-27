#!/usr/bin/env bash
# Build a relocatable Python runtime + deps for bundling inside the macOS .app.
#
# Usage:
#   bash scripts/build-bundled-python.sh              # native (Intel→Intel, M1→arm64)
#   bash scripts/build-bundled-python.sh arm64        # Apple Silicon bundle
#   bash scripts/build-bundled-python.sh x86_64       # Intel bundle
#
# Cross-build (Intel iMac → M1 bundle): downloads arm64 Python, installs arm64 wheels
# with host pip (--platform). Cannot run import tests on the Intel machine.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLED="$ROOT/src-tauri/bundled/python"
CACHE="$ROOT/build/cache"
BACKEND="$ROOT/backend"

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script currently targets macOS only." >&2
  exit 1
fi

REQUESTED="${1:-native}"
HOST_ARCH="$(uname -m)"

resolve_target() {
  case "$REQUESTED" in
    native)
      case "$HOST_ARCH" in
        arm64) echo "aarch64-apple-darwin" ;;
        x86_64) echo "x86_64-apple-darwin" ;;
        *) echo "unsupported" >&2; exit 1 ;;
      esac
      ;;
    arm64|aarch64|apple-silicon|m1)
      echo "aarch64-apple-darwin"
      ;;
    x86_64|intel|x64)
      echo "x86_64-apple-darwin"
      ;;
    -h|--help|help)
      usage 0
      ;;
    *)
      echo "Unknown arch: $REQUESTED (use native, arm64, or x86_64)" >&2
      usage 1
      ;;
  esac
}

PY_ARCH="$(resolve_target)"
CROSS=false
if [[ "$HOST_ARCH" == "x86_64" && "$PY_ARCH" == "aarch64-apple-darwin" ]]; then
  CROSS=true
elif [[ "$HOST_ARCH" == "arm64" && "$PY_ARCH" == "x86_64-apple-darwin" ]]; then
  CROSS=true
fi

PY_RELEASE="20241016"
PY_TAG="cpython-3.12.7+20241016-${PY_ARCH}-install_only"
TARBALL="${PY_TAG}.tar.gz"
URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PY_RELEASE}/${TARBALL}"

echo "Host CPU: ${HOST_ARCH} → bundled Python: ${PY_ARCH} (cross=${CROSS})"

mkdir -p "$CACHE"
if [[ ! -f "$CACHE/$TARBALL" ]]; then
  echo "Downloading ${TARBALL}…"
  curl -fsSL -o "$CACHE/$TARBALL" "$URL"
fi

echo "Extracting Python runtime…"
BUNDLED_PARENT="$(dirname "$BUNDLED")"
rm -rf "$BUNDLED"
mkdir -p "$BUNDLED_PARENT"
tar -xzf "$CACHE/$TARBALL" -C "$BUNDLED_PARENT"
# Tarball unpacks to python/ — same path as $BUNDLED (…/bundled/python). No mv needed.
if [[ ! -x "$BUNDLED/bin/python3" ]]; then
  echo "Unexpected tarball layout: missing $BUNDLED/bin/python3" >&2
  exit 1
fi

LIBDIR="$(find "$BUNDLED/lib" -maxdepth 1 -type d -name 'python3.*' | head -1)"
if [[ -z "$LIBDIR" ]]; then
  echo "Could not find lib/python3.* under $BUNDLED" >&2
  exit 1
fi
SITE_PACKAGES="${LIBDIR}/site-packages"
mkdir -p "$SITE_PACKAGES"

host_python() {
  if command -v python3.12 >/dev/null 2>&1; then
    command -v python3.12
  elif command -v python3 >/dev/null 2>&1; then
    command -v python3
  else
    echo "Need python3 on PATH for cross-install." >&2
    exit 1
  fi
}

pip_native() {
  local py="$BUNDLED/bin/python3"
  export PYTHONHOME="$BUNDLED"
  "$py" -m pip "$@"
}

pip_pure() {
  # Universal pure-Python packages (no per-arch wheel). Required for cross-build.
  local hp
  hp="$(host_python)"
  "$hp" -m pip install --upgrade --target "$SITE_PACKAGES" "$@"
}

install_sgmllib3k() {
  local hp
  hp="$(host_python)"
  if "$hp" -m pip install --target "$SITE_PACKAGES" "sgmllib3k==1.0.0" 2>/dev/null; then
    echo "sgmllib3k installed from PyPI."
    return 0
  fi
  echo "PyPI had no sgmllib3k wheel/sdist; installing from pythonhosted tarball…"
  local tgz="$CACHE/sgmllib3k-1.0.0.tar.gz"
  if [[ ! -f "$tgz" ]]; then
    curl -fsSL -o "$tgz" \
      "https://files.pythonhosted.org/packages/source/s/sgmllib3k/sgmllib3k-1.0.0.tar.gz"
  fi
  "$hp" -m pip install --target "$SITE_PACKAGES" "$tgz"
}

cross_platforms() {
  if [[ "$PY_ARCH" == "aarch64-apple-darwin" ]]; then
    # scikit-learn / scipy publish macosx_12_0_arm64 wheels (not 11_0)
    echo "macosx_12_0_arm64 macosx_11_0_arm64 macosx_10_9_universal2"
  else
    echo "macosx_10_9_x86_64 macosx_10_13_x86_64"
  fi
}

pip_cross() {
  local hp
  hp="$(host_python)"
  local abi="cp312"
  local platform ok=false
  for platform in $(cross_platforms); do
    if "$hp" -m pip install \
      --upgrade \
      --target "$SITE_PACKAGES" \
      --platform "$platform" \
      --python-version 3.12 \
      --implementation cp \
      --abi "$abi" \
      --only-binary=:all: \
      "$@"; then
      ok=true
      break
    fi
  done
  if [[ "$ok" != true ]]; then
    echo "Cross-install failed for: $*" >&2
    return 1
  fi
}

install_ml_cross() {
  echo "ML stack: torch + transformers + sentence-transformers…"
  pip_cross -r "$BACKEND/requirements-ml.txt"
}

pip_install_reqs() {
  local req="$1"
  local label="$2"
  if [[ "$CROSS" == true ]]; then
    echo "Cross-installing ${label}…"
    local cross_req="$req"
    if [[ "$req" == *requirements-core.txt ]]; then
      cross_req="$CACHE/requirements-core.cross.txt"
      grep -v '^feedparser' "$req" | grep -v '^sgmllib3k' > "$cross_req"
    fi
    pip_cross -r "$cross_req"
  else
    echo "Installing ${label}…"
    pip_native install --prefer-binary -r "$req"
  fi
}

if [[ "$CROSS" == true ]]; then
  echo "Cross-build: installing into ${SITE_PACKAGES} (host pip)…"
  pip_pure pip setuptools wheel
  echo "Pure-Python deps (feedparser, etc.)…"
  install_sgmllib3k
  pip_pure eval-type-backport feedparser
  echo "Installing PyTorch (CPU)…"
  pip_cross torch --index-url https://download.pytorch.org/whl/cpu
  pip_install_reqs "$BACKEND/requirements-core.txt" "core packages"
  install_ml_cross
  echo "Skipping import test (target CPU ≠ host). Verify on the target Mac after install."
else
  export PYTHONHOME="$BUNDLED"
  pip_native install --upgrade pip wheel setuptools
  echo "Installing PyTorch (CPU)…"
  pip_native install torch --index-url https://download.pytorch.org/whl/cpu
  pip_install_reqs "$BACKEND/requirements-core.txt" "core packages"
  pip_install_reqs "$BACKEND/requirements-ml.txt" "ML packages"
  echo "Verifying imports…"
  "$BUNDLED/bin/python3" -c "import fastapi, uvicorn, numpy, sentence_transformers; print('All imports OK')"
fi

bash "$ROOT/scripts/strip-bundled-python.sh" "$BUNDLED"

# --- Post-strip integrity check ---------------------------------------------
# Strip step is destructive; verify nothing critical was deleted.
SITE="$SITE_PACKAGES"
REQUIRED_DIRS=(
  "$SITE/torch/testing"
  "$SITE/torch/nn"
  "$SITE/torch/autograd"
  "$SITE/numpy/testing"
  "$SITE/transformers/models"
  "$SITE/sentence_transformers"
)
missing=()
for d in "${REQUIRED_DIRS[@]}"; do
  if [[ ! -d "$d" ]]; then
    missing+=("$d")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "ERROR: strip removed required runtime directories:" >&2
  for m in "${missing[@]}"; do
    echo "  - $m" >&2
  done
  exit 1
fi

if [[ "$CROSS" != true ]]; then
  echo "Verifying import after strip…"
  "$BUNDLED/bin/python3" -c "import torch, transformers; from sentence_transformers import SentenceTransformer; print('Post-strip imports OK', torch.__version__)"
fi

echo ""
echo "Bundled Python ready at: $BUNDLED (${PY_ARCH}, cross=${CROSS})"
du -sh "$BUNDLED" || true
