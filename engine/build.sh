#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
emsdk_dir="${EMSDK_DIR:-$root/build/emsdk}"
variant="${ENGINE_VARIANT:-fixed}"
tier_mib=64
tier_bytes=$((tier_mib * 1024 * 1024))
name="engine-core-${tier_mib}mib"
flags=(-std=c++20 -O2 -g0 -ffp-contract=off -fno-fast-math -fdebug-prefix-map="$root"=. "-DENGINE_TIER_BYTES=${tier_bytes}ull")
link=(-sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,node -sEXPORTED_RUNTIME_METHODS=HEAPU8 "-sINITIAL_MEMORY=${tier_bytes}" -sSTRICT=1)
case "$variant" in
  fixed) link+=(-sALLOW_MEMORY_GROWTH=0 "-sMAXIMUM_MEMORY=${tier_bytes}") ;;
  leak) name="${name}-leak"; flags+=(-DENGINE_LEAK_ON_TICK); link+=(-sALLOW_MEMORY_GROWTH=1) ;;
  *) echo "unknown ENGINE_VARIANT: $variant" >&2; exit 2 ;;
esac
mkdir -p "$here/out"
source "$emsdk_dir/emsdk_env.sh" >/dev/null
emcc "${flags[@]}" "${link[@]}" -sEXPORTED_FUNCTIONS=_engine_init,_engine_tick,_engine_ticks,_engine_memory_bytes "$here/src/engine_core.cpp" -o "$here/out/$name.mjs"
sha256sum "$here/out/$name.wasm"
