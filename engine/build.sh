#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
emsdk_dir="${EMSDK_DIR:-$root/build/emsdk}"
variant="${ENGINE_VARIANT:-fixed}"
case "$variant" in
  fixed) leak=OFF; suffix="" ;;
  leak) leak=ON; suffix="-leak" ;;
  *) echo "unknown ENGINE_VARIANT: $variant" >&2; exit 2 ;;
esac
build_dir="$root/build/engine-$variant"
source "$emsdk_dir/emsdk_env.sh" >/dev/null
emcmake cmake -S "$here" -B "$build_dir" -DENGINE_TIER_MIB=64 -DENGINE_LEAK_ON_TICK="$leak"
cmake --build "$build_dir" --parallel
sha256sum "$here/out/engine-core-64mib$suffix.wasm"
