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
jolt_pin=0373ec0dd762e4bc2f6acdb08371ee84fa23c6db
jolt_sha256=b7345eed117bf73208e2be93075b278c9b47d3a52d7101d1056eff718ac9eb44
if [ -z "${JOLT_SOURCE:-}" ]; then
  JOLT_SOURCE="$root/build/deps/JoltPhysics-$jolt_pin"
  if [ ! -f "$JOLT_SOURCE/Build/CMakeLists.txt" ]; then
    archive="$here/deps/JoltPhysics-$jolt_pin.tar.gz"
    test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$jolt_sha256" || { echo "Jolt archive sha256 mismatch: $archive" >&2; exit 3; }
    mkdir -p "$root/build/deps"
    tar -xzf "$archive" -C "$root/build/deps"
  fi
fi
jolt_arg=(-DFETCHCONTENT_SOURCE_DIR_JOLTPHYSICS="$JOLT_SOURCE")
emcmake cmake -S "$here" -B "$build_dir" -DENGINE_TIER_MIB="$tier" -DENGINE_LEAK_ON_TICK="$leak" -DENGINE_PHASE_TIMERS="$timers" -DENGINE_THREADS="$threads" -DENGINE_WASM_SIMD="$simd" "${jolt_arg[@]}"
cmake --build "$build_dir" --parallel
out_suffix="$suffix"
if [ "$simd" = "ON" ]; then out_suffix="$suffix-simd"; fi
sha256sum "$here/out/engine-core-${tier}mib$out_suffix.wasm"
