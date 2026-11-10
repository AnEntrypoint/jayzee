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
  threadstimed) leak=OFF; timers=ON; threads=ON; suffix="-timed-threads" ;;
  *) echo "unknown ENGINE_VARIANT: $variant" >&2; exit 2 ;;
esac
simd="${ENGINE_WASM_SIMD:-OFF}"
simd_suffix=""
if [ "$simd" = "ON" ]; then simd_suffix="-simd"; fi
build_dir="$root/build/engine-$variant-${tier}mib$simd_suffix"
source "$emsdk_dir/emsdk_env.sh" >/dev/null
jolt_arg=()
if [ -n "${JOLT_SOURCE:-}" ]; then jolt_arg=(-DFETCHCONTENT_SOURCE_DIR_JOLTPHYSICS="$JOLT_SOURCE"); fi
emcmake cmake -S "$here" -B "$build_dir" -DENGINE_TIER_MIB="$tier" -DENGINE_LEAK_ON_TICK="$leak" -DENGINE_PHASE_TIMERS="$timers" -DENGINE_THREADS="$threads" -DENGINE_WASM_SIMD="$simd" "${jolt_arg[@]}"
cmake --build "$build_dir" --parallel
out_suffix="$suffix"
if [ "$simd" = "ON" ]; then out_suffix="$suffix-simd"; fi
sha256sum "$here/out/engine-core-${tier}mib$out_suffix.wasm"
