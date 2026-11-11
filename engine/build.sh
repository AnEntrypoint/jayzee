#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
emsdk_dir="${EMSDK_DIR:-$root/build/emsdk}"
variant="${ENGINE_VARIANT:-fixed}"
tier="${ENGINE_TIER_MIB:-64}"
timers=OFF
threads=OFF
profile=OFF
case "$variant" in
  fixed) leak=OFF; suffix="" ;;
  leak) leak=ON; suffix="-leak" ;;
  timed) leak=OFF; timers=ON; suffix="-timed" ;;
  threads) leak=OFF; threads=ON; suffix="-threads" ;;
  threadstimed) leak=OFF; timers=ON; threads=ON; suffix="-timed-threads" ;;
  threadsprofile) leak=OFF; threads=ON; profile=ON; suffix="-threads" ;;
  *) echo "unknown ENGINE_VARIANT: $variant" >&2; exit 2 ;;
esac
simd="${ENGINE_WASM_SIMD:-OFF}"
simd_suffix=""
if [ "$simd" = "ON" ]; then simd_suffix="-simd"; fi
build_dir="$root/build/engine-$variant-${tier}mib$simd_suffix"
source "$emsdk_dir/emsdk_env.sh" >/dev/null
jolt_pin=0373ec0dd762e4bc2f6acdb08371ee84fa23c6db
jolt_sha256=b7345eed117bf73208e2be93075b278c9b47d3a52d7101d1056eff718ac9eb44
jolt_patch="$here/deps/jolt-broadphase-interval.patch"
jolt_patch_tag="$(sha256sum "$jolt_patch" | cut -c1-12)"
if [ -z "${JOLT_SOURCE:-}" ]; then
  jolt_home="$root/build/deps/patched-$jolt_patch_tag"
  JOLT_SOURCE="$jolt_home/JoltPhysics-$jolt_pin"
  if [ ! -f "$jolt_home/ready" ]; then
    archive="$here/deps/JoltPhysics-$jolt_pin.tar.gz"
    test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$jolt_sha256" || { echo "Jolt archive sha256 mismatch: $archive" >&2; exit 3; }
    rm -rf "$jolt_home"
    mkdir -p "$jolt_home"
    tar -xzf "$archive" -C "$jolt_home"
    patch -p1 -s -d "$JOLT_SOURCE" < "$jolt_patch"
    touch "$jolt_home/ready"
  fi
fi
jolt_arg=(-DFETCHCONTENT_SOURCE_DIR_JOLTPHYSICS="$JOLT_SOURCE")
emcmake cmake -S "$here" -B "$build_dir" -DENGINE_TIER_MIB="$tier" -DENGINE_LEAK_ON_TICK="$leak" -DENGINE_PHASE_TIMERS="$timers" -DENGINE_THREADS="$threads" -DENGINE_WASM_SIMD="$simd" -DENGINE_TICK_PROFILE="$profile" "${jolt_arg[@]}"
cmake --build "$build_dir" --parallel "${ENGINE_BUILD_JOBS:-8}"
out_suffix="$suffix"
if [ "$simd" = "ON" ]; then out_suffix="$suffix-simd"; fi
out_dir="$here/out"
if [ "$profile" = "ON" ]; then out_dir="$root/build/variants/profile"; fi
sha256sum "$out_dir/engine-core-${tier}mib$out_suffix.wasm"
