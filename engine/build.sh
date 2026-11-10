#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
emsdk_dir="${EMSDK_DIR:-$root/build/emsdk}"
variant="${ENGINE_VARIANT:-fixed}"
tier="${ENGINE_TIER_MIB:-64}"
timers=OFF
threads=OFF
case "$variant" in
  fixed) leak=OFF; suffix="" ;;
  leak) leak=ON; suffix="-leak" ;;
  timed) leak=OFF; timers=ON; suffix="-timed" ;;
  threads) leak=OFF; threads=ON; suffix="-threads" ;;
  *) echo "unknown ENGINE_VARIANT: $variant" >&2; exit 2 ;;
esac
build_dir="$root/build/engine-$variant-${tier}mib"
source "$emsdk_dir/emsdk_env.sh" >/dev/null
emcmake cmake -S "$here" -B "$build_dir" -DENGINE_TIER_MIB="$tier" -DENGINE_LEAK_ON_TICK="$leak" -DENGINE_PHASE_TIMERS="$timers" -DENGINE_THREADS="$threads"
cmake --build "$build_dir" --parallel
sha256sum "$here/out/engine-core-${tier}mib$suffix.wasm"
