#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$(dirname "$here")")"
engine="$root/engine"
jolt_include="$root/build/jolt"
jolt_lib="$root/build/host-jolt/libJolt.a"
out="$root/build/engine-host-witness"
mkdir -p "$out"
c++ -std=c++20 -O2 -DNDEBUG -ffp-contract=off -fno-fast-math -fno-exceptions -fno-rtti -pthread \
  -mavx2 -mbmi -mpopcnt -mlzcnt -mf16c -mfpmath=sse \
  -DJPH_CROSS_PLATFORM_DETERMINISTIC -DJPH_USE_AVX -DJPH_USE_AVX2 -DJPH_USE_F16C -DJPH_USE_LZCNT \
  -DJPH_USE_SSE4_1 -DJPH_USE_SSE4_2 -DJPH_USE_TZCNT \
  -DENGINE_ARENA_BYTES=268435456ull \
  -I"$jolt_include" -I"$engine/src" -I"$engine/test" \
  "$engine/test/main_all.cpp" \
  "$engine/test/witness_phase2_world.cpp" \
  "$engine/test/witness_phase3_bridge.cpp" \
  "$engine/test/witness_phase4_pools.cpp" \
  "$engine/test/witness_phase5_planet.cpp" \
  "$engine/test/witness_phase6_vegetation.cpp" \
  "$engine/test/witness_phase7_codecs.cpp" \
  "$engine/test/witness_phase8_resources.cpp" \
  "$engine/test/witness_phase10_plan.cpp" \
  "$engine/test/witness_models.cpp" \
  "$engine/test/witness_visibility.cpp" \
  "$engine/src/render/render_frame.cpp" \
  "$engine/src/world.cpp" \
  "$engine/src/bridge.cpp" \
  "$engine/src/planet_frame.cpp" \
  "$engine/src/page_cache.cpp" \
  "$engine/src/planet_shape.cpp" \
  "$engine/src/vegetation.cpp" \
  "$engine/src/codec.cpp" \
  "$engine/src/materials.cpp" \
  "$engine/src/textures.cpp" \
  "$engine/src/model_pool.cpp" \
  "$engine/src/device_tier.cpp" \
  "$engine/src/arena.cpp" \
  "$engine/src/budget.cpp" \
  "$engine/src/pool_alloc.cpp" \
  "$jolt_lib" \
  -o "$out/engine-witness"
"$out/engine-witness"
